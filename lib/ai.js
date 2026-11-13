const DEFAULT_SPIDERWEB_API_URL = 'https://spiderwebargapi.com.ar/api/v1';
const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash';

function parseJsonArray(text) {
  if (!text || typeof text !== 'string') return null;
  const cleaned = text
    .replace(/```json\s*/gi, '')
    .replace(/```\s*/g, '')
    .trim();
  const match = cleaned.match(/\[[\s\S]*\]/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]);
    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed
        .filter(item => item && typeof item.title === 'string' && item.title.trim())
        .map(item => ({
          title: item.title.trim(),
          category: String(item.category || 'IA').trim() || 'IA',
          weather: String(item.weather || 'Cualquiera').trim() || 'Cualquiera'
        }));
    }
  } catch {
    return null;
  }
  return null;
}

function buildLocalContextualPlans(coupleContext = {}) {
  const food = coupleContext.foods?.filter(Boolean).join(' o ') || 'su comida favorita';
  const series = coupleContext.movies?.filter(Boolean).join(' / ') || 'una peli sorpresa';
  const weather = coupleContext.weathers?.filter(Boolean)[0] || 'Templado';
  const favPlan = coupleContext.plans?.filter(Boolean)[0] || 'salida espontánea';
  return {
    provider: 'HifaIA (Local Contextual)',
    model: 'local-contextual',
    plans: [
      { title: `Cena temática preparando o pidiendo ${food} con velas y música`, category: 'Gastronomía', weather: 'Cualquiera' },
      { title: `Maratón especial de ${series} con snacks y postres favoritos`, category: 'En casa', weather: 'Frío / Lluvia' },
      { title: `Escapada de ${favPlan} aprovechando un día de clima ${weather}`, category: 'Aventura', weather }
    ]
  };
}

function resolveMergedConfig(cfg = {}, overrides = {}) {
  const merged = { ...cfg };
  for (const [k, v] of Object.entries(overrides || {})) {
    if (v !== undefined && v !== null) merged[k] = String(v);
  }
  return merged;
}

function resolveSpiderAiCredentials(cfg = {}, overrides = {}) {
  const merged = resolveMergedConfig(cfg, overrides);
  const apiUrl = (merged.spiderweb_api_url || DEFAULT_SPIDERWEB_API_URL).replace(/\/+$/, '');
  const apiKey = (merged.spider_ai_apikey || '').trim() || (merged.spiderapikey || '').trim();
  return { apiUrl, apiKey, modelId: (merged.spider_ai_model || '').trim() };
}

async function listSpiderAiModels(cfg = {}, overrides = {}) {
  const { apiUrl, apiKey } = resolveSpiderAiCredentials(cfg, overrides);
  if (!apiKey) {
    throw new Error('Falta la API Key de SpiderWeb (spider_ai_apikey o spiderapikey).');
  }
  const resp = await fetch(`${apiUrl}/ia/models`, {
    headers: { 'X-API-KEY': apiKey },
    signal: AbortSignal.timeout(7000)
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    throw new Error(data?.error || data?.message || `SpiderWeb /ia/models respondió HTTP ${resp.status}`);
  }
  const rawList = Array.isArray(data?.models)
    ? data.models
    : Array.isArray(data?.data)
      ? data.data
      : Array.isArray(data)
        ? data
        : [];
  return rawList
    .map(m => {
      if (typeof m === 'string') return { id: m, name: m };
      const id = m?.id || m?.model_id || m?.name || '';
      if (!id) return null;
      return {
        id: String(id),
        name: String(m?.name || m?.label || id),
        provider: m?.provider ? String(m.provider) : '',
        description: m?.description ? String(m.description) : ''
      };
    })
    .filter(Boolean);
}

async function callSpiderAiChat({ apiUrl, apiKey, modelId, systemPrompt, userPrompt, timeoutMs = 10000 }) {
  if (!apiKey) throw new Error('Falta API Key de SpiderWeb IA.');
  let targetModel = (modelId || '').trim();
  if (!targetModel) {
    const models = await listSpiderAiModels({ spiderweb_api_url: apiUrl, spider_ai_apikey: apiKey });
    targetModel = models[0]?.id || '';
  }
  if (!targetModel) {
    throw new Error('SpiderWeb no devolvió modelos disponibles en /ia/models.');
  }

  const resp = await fetch(`${apiUrl}/ia/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-KEY': apiKey },
    body: JSON.stringify({
      model_id: targetModel,
      messages: [
        ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
        { role: 'user', content: userPrompt }
      ]
    }),
    signal: AbortSignal.timeout(timeoutMs)
  });

  const reply = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    throw new Error(reply?.error || reply?.message || `SpiderWeb /ia/chat respondió HTTP ${resp.status}`);
  }
  const text =
    reply?.message?.content ||
    reply?.choices?.[0]?.message?.content ||
    reply?.content ||
    '';
  return { text: String(text), modelId: targetModel, usage: reply?.usage };
}

async function callGeminiChat({ apiKey, model = DEFAULT_GEMINI_MODEL, systemPrompt, userPrompt, timeoutMs = 10000 }) {
  const cleanKey = (apiKey || '').trim();
  const cleanModel = (model || DEFAULT_GEMINI_MODEL).trim();
  if (!cleanKey) throw new Error('Falta la API Key de Google Gemini.');

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(cleanModel)}:generateContent?key=${encodeURIComponent(cleanKey)}`;
  const body = {
    contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
    generationConfig: { temperature: 0.8 }
  };
  if (systemPrompt) {
    body.systemInstruction = { parts: [{ text: systemPrompt }] };
  }

  const resp = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs)
  });

  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    throw new Error(data?.error?.message || `Gemini API respondió HTTP ${resp.status}`);
  }

  const parts = data?.candidates?.[0]?.content?.parts || [];
  const text = parts.map(p => p?.text || '').join('');
  return { text: String(text), model: cleanModel, usage: data?.usageMetadata };
}

async function testAiConfig(cfg = {}, overrides = {}) {
  const merged = resolveMergedConfig(cfg, overrides);
  const provider = merged.ai_provider || 'spideria';

  if (provider === 'local') {
    return {
      ok: true,
      provider: 'local',
      model: 'HifaIA Local Contextual',
      sampleReply: 'Modo local activo: genera sugerencias según los gustos de la pareja sin llamadas externas.'
    };
  }

  if (provider === 'gemini') {
    const apiKey = (merged.gemini_apikey || '').trim();
    const model = (merged.gemini_model || DEFAULT_GEMINI_MODEL).trim();
    const reply = await callGeminiChat({
      apiKey,
      model,
      userPrompt: 'Responde únicamente con: OK'
    });
    return {
      ok: true,
      provider: 'gemini',
      model: reply.model,
      sampleReply: reply.text.trim().slice(0, 120)
    };
  }

  // Default: spideria
  const { apiUrl, apiKey, modelId } = resolveSpiderAiCredentials(merged);
  const models = await listSpiderAiModels({ spiderweb_api_url: apiUrl, spider_ai_apikey: apiKey });
  const targetModel = modelId || models[0]?.id || '';
  if (!targetModel) {
    throw new Error('No se encontraron modelos de IA en SpiderWebAPI (/ia/models).');
  }
  const reply = await callSpiderAiChat({
    apiUrl,
    apiKey,
    modelId: targetModel,
    userPrompt: 'Responde únicamente con: OK'
  });
  return {
    ok: true,
    provider: 'spideria',
    model: reply.modelId,
    models,
    sampleReply: reply.text.trim().slice(0, 120)
  };
}

async function generateAiPlans(cfg = {}, coupleContext = {}) {
  const provider = cfg.ai_provider || 'spideria';
  const systemPrompt =
    'Eres un asistente experto en citas y planes para parejas. Devuelve SOLO un JSON array de 3 objetos con {"title": "...", "category": "...", "weather": "..."} sin texto extra.';
  const userPrompt = `Propone 3 planes semanales creativos para esta pareja según sus gustos: ${JSON.stringify(coupleContext)}`;

  if (provider === 'gemini' && (cfg.gemini_apikey || '').trim()) {
    try {
      const reply = await callGeminiChat({
        apiKey: cfg.gemini_apikey,
        model: cfg.gemini_model || DEFAULT_GEMINI_MODEL,
        systemPrompt,
        userPrompt
      });
      const parsed = parseJsonArray(reply.text);
      if (parsed && parsed.length > 0) {
        return { provider: 'Gemini', model: reply.model, plans: parsed, usage: reply.usage };
      }
    } catch {
      // Fallback below
    }
  } else if (provider === 'spideria') {
    const { apiUrl, apiKey, modelId } = resolveSpiderAiCredentials(cfg);
    if (apiKey) {
      try {
        const reply = await callSpiderAiChat({
          apiUrl,
          apiKey,
          modelId,
          systemPrompt,
          userPrompt
        });
        const parsed = parseJsonArray(reply.text);
        if (parsed && parsed.length > 0) {
          return { provider: 'SpiderIA', model: reply.modelId, plans: parsed, usage: reply.usage };
        }
      } catch {
        // Fallback below
      }
    }
  }

  return buildLocalContextualPlans(coupleContext);
}

module.exports = {
  DEFAULT_GEMINI_MODEL,
  parseJsonArray,
  buildLocalContextualPlans,
  resolveSpiderAiCredentials,
  listSpiderAiModels,
  callSpiderAiChat,
  callGeminiChat,
  testAiConfig,
  generateAiPlans
};

