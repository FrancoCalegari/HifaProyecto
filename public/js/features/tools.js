import { api } from '../core/api.js';
import { escapeHtml } from '../core/utils.js';

/* ================= HERRAMIENTAS: RULETA Y PLANES SEMANALES + IA ================= */

const SLICE_COLORS = [
  '#f43f5e', // Rosa vivo
  '#3b82f6', // Azul cielo
  '#10b981', // Verde esmeralda
  '#f59e0b', // Ámbar cálido
  '#8b5cf6', // Violeta intenso
  '#ec4899', // Fucsia
  '#06b6d4', // Cian brillante
  '#f97316', // Naranja
  '#14b8a6', // Turquesa
  '#6366f1', // Índigo
  '#84cc16', // Lima
  '#d946ef'  // Magenta
];

const PRESETS = [
  {
    name: '🍕 ¿Qué comemos hoy?',
    options: ['Pizza', 'Hamburguesas', 'Sushi', 'Empanadas', 'Pastas caseras', 'Tacos', 'Milanesas']
  },
  {
    name: '🍽️ ¿Quién lava los platos?',
    options: ['Franco', 'Daniela', '¡Los dos juntos!', 'Se lava mañana']
  },
  {
    name: '🎬 ¿Qué vemos esta noche?',
    options: ['Comedia', 'Terror', 'Acción', 'Serie de Misterio', 'Documental', 'Romántica']
  },
  {
    name: '🏖️ ¿Plan para el fin de semana?',
    options: ['Picnic al parque', 'Maratón de pelis en cama', 'Salir a merendar', 'Cocinar algo nuevo', 'Caminata o río']
  }
];

// Estado local de la ruleta
let currentWheelAngle = 0; // Ángulo actual en radianes
let isSpinning = false;
let animFrameId = null;
let activeRoulette = null;
let cachedRoulettes = [];
let soundEnabled = localStorage.getItem('hifa_roulette_sound') !== 'false';
let audioCtx = null;

// Efectos de sonido sintéticos nativos (Web Audio API)
function getAudioContext() {
  if (!audioCtx) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (AudioContextClass) audioCtx = new AudioContextClass();
  }
  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
  return audioCtx;
}

function playTickSound() {
  if (!soundEnabled) return;
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(750, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(180, ctx.currentTime + 0.035);
    gain.gain.setValueAtTime(0.12, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.035);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.04);
  } catch (_) {}
}

function playWinChime() {
  if (!soundEnabled) return;
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    const chords = [523.25, 659.25, 783.99, 1046.5]; // C5, E5, G5, C6
    chords.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, ctx.currentTime + idx * 0.09);
      gain.gain.setValueAtTime(0, ctx.currentTime + idx * 0.09);
      gain.gain.linearRampToValueAtTime(0.18, ctx.currentTime + idx * 0.09 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + idx * 0.09 + 0.38);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(ctx.currentTime + idx * 0.09);
      osc.stop(ctx.currentTime + idx * 0.09 + 0.42);
    });
  } catch (_) {}
}

function normalizeAngle(a) {
  return ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
}

// Dibujado del lienzo de la ruleta (HTML5 Canvas)
function drawWheel(canvas, options, angle) {
  if (!canvas || !options || options.length === 0) return;

  const dpr = window.devicePixelRatio || 1;
  const size = 340;
  if (canvas.width !== size * dpr) {
    canvas.width = size * dpr;
    canvas.height = size * dpr;
  }

  const ctx = canvas.getContext('2d');
  ctx.save();
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, size, size);

  const cx = size / 2;
  const cy = size / 2;
  const radius = size / 2 - 14;
  const N = options.length;
  const Delta = (2 * Math.PI) / N;

  // 1. Sombra suave de la base
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, 2 * Math.PI);
  ctx.fillStyle = '#1e1b26';
  ctx.fill();

  // 2. Dibujar cada sector / porción
  for (let i = 0; i < N; i++) {
    const startA = angle + i * Delta;
    const endA = angle + (i + 1) * Delta;

    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, radius, startA, endA);
    ctx.closePath();

    ctx.fillStyle = SLICE_COLORS[i % SLICE_COLORS.length];
    ctx.fill();

    // Borde blanco de separación
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Texto de la opción
    const midA = startA + Delta / 2;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(midA);
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 13px system-ui, -apple-system, sans-serif';
    ctx.shadowColor = 'rgba(0, 0, 0, 0.65)';
    ctx.shadowBlur = 4;

    const rawText = String(options[i] || '');
    const displayText = rawText.length > 15 ? rawText.slice(0, 13) + '…' : rawText;
    ctx.fillText(displayText, radius - 20, 0);
    ctx.restore();
  }

  // 3. Pernos decorativos alrededor del perímetro
  const pegCount = Math.max(N, 16);
  for (let p = 0; p < pegCount; p++) {
    const pegA = angle + p * ((2 * Math.PI) / pegCount);
    const px = cx + (radius - 5) * Math.cos(pegA);
    const py = cy + (radius - 5) * Math.sin(pegA);

    ctx.beginPath();
    ctx.arc(px, py, 3.5, 0, 2 * Math.PI);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.35)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  // 4. Anillo exterior del centro
  ctx.beginPath();
  ctx.arc(cx, cy, 39, 0, 2 * Math.PI);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.18)';
  ctx.fill();
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 3;
  ctx.stroke();

  ctx.restore();
}

// Animación física del giro y cálculo exacto del ganador
function spinWheel(canvas, options, onFinish) {
  if (isSpinning || !options || options.length < 2) return;
  isSpinning = true;

  const needle = document.getElementById('roulette-needle');
  const spinBtn = document.getElementById('btn-center-spin');
  const mainSpinBtn = document.getElementById('btn-main-spin');
  const winnerBox = document.getElementById('roulette-winner-box');

  if (spinBtn) spinBtn.disabled = true;
  if (mainSpinBtn) {
    mainSpinBtn.disabled = true;
    mainSpinBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Girando...';
  }
  if (winnerBox) winnerBox.innerHTML = '';
  if (canvas) canvas.classList.add('is-spinning');

  // 1. Elegir índice ganador
  const N = options.length;
  const Delta = (2 * Math.PI) / N;
  const winningIndex = Math.floor(Math.random() * N);
  const winningOption = options[winningIndex];

  // 2. Calcular ángulo exacto para que el sector ganador quede centrado bajo el indicador superior (12 o'clock / 1.5*PI)
  // Agregamos una ligera fluctuación orgánica (jitter) dentro del 65% central del sector
  const jitter = (Math.random() - 0.5) * (Delta * 0.65);
  const targetNorm = normalizeAngle(1.5 * Math.PI - (winningIndex + 0.5) * Delta + jitter);
  const currentNorm = normalizeAngle(currentWheelAngle);

  let diff = targetNorm - currentNorm;
  if (diff <= 0) diff += 2 * Math.PI;

  // Giros completos (entre 6 y 8 vueltas completas)
  const extraSpins = (6 + Math.floor(Math.random() * 3)) * (2 * Math.PI);
  const totalAngleToSpin = extraSpins + diff;
  const startAngle = currentWheelAngle;

  const duration = 3800; // 3.8 segundos de giro con desaceleración
  const startTime = performance.now();

  const pegCount = Math.max(N, 16);
  const pegAngle = (2 * Math.PI) / pegCount;
  let lastPeg = Math.floor(currentWheelAngle / pegAngle);

  function frame(now) {
    const elapsed = now - startTime;
    const progress = Math.min(1, elapsed / duration);

    // Easing cuartico out (desaceleración suave y realista)
    const eased = 1 - Math.pow(1 - progress, 4);
    currentWheelAngle = startAngle + totalAngleToSpin * eased;

    // Detectar paso de pernos para sonido y animación de la aguja
    const currentPeg = Math.floor(currentWheelAngle / pegAngle);
    if (currentPeg !== lastPeg) {
      lastPeg = currentPeg;
      playTickSound();
      if (needle) {
        needle.classList.add('needle-flick');
        setTimeout(() => needle.classList.remove('needle-flick'), 70);
      }
    }

    drawWheel(canvas, options, currentWheelAngle);

    if (progress < 1) {
      animFrameId = requestAnimationFrame(frame);
    } else {
      isSpinning = false;
      if (canvas) canvas.classList.remove('is-spinning');
      if (spinBtn) spinBtn.disabled = false;
      if (mainSpinBtn) {
        mainSpinBtn.disabled = false;
        mainSpinBtn.innerHTML = '<i class="fa-solid fa-dice"></i> ¡Girar de Nuevo!';
      }

      // Celebración y fanfarria
      playWinChime();
      launchConfetti();

      if (winnerBox) {
        winnerBox.innerHTML = `
          <div class="roulette-winner-card">
            <div class="winner-title"><i class="fa-solid fa-trophy" style="color:#f59e0b;"></i> ¡El destino eligió!</div>
            <div class="winner-name">${escapeHtml(winningOption)}</div>
          </div>
        `;
      }

      if (typeof onFinish === 'function') {
        onFinish(winningOption);
      }
    }
  }

  animFrameId = requestAnimationFrame(frame);
}

// Efecto de confeti en el contenedor
function launchConfetti() {
  const container = document.getElementById('roulette-stage-box');
  if (!container) return;

  const colors = ['#f43f5e', '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899'];
  for (let i = 0; i < 35; i++) {
    const el = document.createElement('div');
    el.style.position = 'absolute';
    el.style.width = `${Math.floor(Math.random() * 8 + 6)}px`;
    el.style.height = `${Math.floor(Math.random() * 12 + 6)}px`;
    el.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
    el.style.left = `${Math.random() * 80 + 10}%`;
    el.style.top = `${Math.random() * 40 + 20}%`;
    el.style.opacity = '1';
    el.style.borderRadius = '3px';
    el.style.pointerEvents = 'none';
    el.style.zIndex = '30';
    el.style.transition = 'transform 1.4s cubic-bezier(0.1, 0.8, 0.3, 1), opacity 1.4s ease';
    container.appendChild(el);

    const xOffset = (Math.random() - 0.5) * 220;
    const yOffset = Math.random() * 180 + 60;
    const rot = Math.random() * 720 - 360;

    requestAnimationFrame(() => {
      el.style.transform = `translate(${xOffset}px, ${yOffset}px) rotate(${rot}deg)`;
      el.style.opacity = '0';
    });

    setTimeout(() => {
      el.remove();
    }, 1500);
  }
}

async function renderToolsTab(container, ctx) {
  // Cancelar animación en curso si la hubiera
  if (animFrameId) {
    cancelAnimationFrame(animFrameId);
    animFrameId = null;
    isSpinning = false;
  }

  const [{ roulettes }, { plans }] = await Promise.all([
    api('/api/roulettes'),
    api('/api/plans')
  ]);

  cachedRoulettes = roulettes || [];

  // Definir ruleta activa por defecto
  if (!activeRoulette || !cachedRoulettes.some(r => r.id === activeRoulette.id)) {
    activeRoulette = cachedRoulettes.length > 0 ? cachedRoulettes[0] : PRESETS[0];
  }

  const selectedPlan = plans.find(p => p.selected_for_week);
  const activeOpts = activeRoulette?.options || PRESETS[0].options;

  container.innerHTML = `
    <div class="grid-2">
      <!-- Columna 1: Ruleta Interactiva -->
      <section class="card">
        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:0.5rem; margin-bottom:0.75rem;">
          <div>
            <h2 style="margin:0;"><i class="fa-solid fa-dharmachakra" style="color:var(--brand);"></i> Ruleta de Pareja</h2>
            <p class="text-muted" style="margin:0.2rem 0 0 0;">
              Activa: <strong>${escapeHtml(activeRoulette?.name || 'Ruleta')}</strong> (${activeOpts.length} opciones)
            </p>
          </div>
          <button type="button" class="btn btn-sm" data-action="toggle-sound">
            ${soundEnabled ? '<i class="fa-solid fa-volume-high"></i> Sonido' : '<i class="fa-solid fa-volume-xmark"></i> Silencio'}
          </button>
        </div>

        <!-- Escenario de la Ruleta -->
        <div class="roulette-stage" id="roulette-stage-box">
          <div class="roulette-wrapper">
            <!-- Aguja indicadora superior -->
            <div class="roulette-needle" id="roulette-needle" title="Puntero">
              <svg width="34" height="44" viewBox="0 0 34 44" fill="none">
                <path d="M17 44L4 12C1.5 6.5 5.5 1 11.5 1H22.5C28.5 1 32.5 6.5 30 12L17 44Z" fill="var(--brand)" stroke="#ffffff" stroke-width="2.5" />
                <circle cx="17" cy="13" r="5" fill="#ffffff" />
              </svg>
            </div>

            <!-- Canvas de la Ruleta -->
            <canvas id="roulette-canvas" class="roulette-canvas" width="340" height="340" data-action="spin-active-roulette" title="Haz clic para girar"></canvas>

            <!-- Botón central de giro -->
            <button type="button" id="btn-center-spin" class="roulette-center-btn" data-action="spin-active-roulette" title="¡Girar la ruleta!">
              <span><i class="fa-solid fa-dice"></i></span>
              <span>GIRAR</span>
            </button>
          </div>

          <!-- Botón de acción principal -->
          <div style="display:flex; gap:0.5rem; justify-content:center; margin-top:0.5rem;">
            <button type="button" id="btn-main-spin" class="btn btn-primary" data-action="spin-active-roulette" style="font-size:1.05rem; padding:0.6rem 1.8rem;">
              <i class="fa-solid fa-dice"></i> ¡Girar Ruleta!
            </button>
          </div>

          <!-- Caja de Anuncio del Ganador -->
          <div class="roulette-winner-box" id="roulette-winner-box"></div>
        </div>

        <!-- Plantillas Rápidas -->
        <div style="margin-top:1.25rem;">
          <label style="font-size:0.85rem; font-weight:700; color:var(--muted);"><i class="fa-regular fa-lightbulb"></i> Plantillas rápidas para agregar:</label>
          <div class="roulette-preset-list">
            ${PRESETS.map(
              (p, idx) => `<button type="button" class="roulette-preset-btn" data-action="apply-preset" data-preset-idx="${idx}">${escapeHtml(p.name)}</button>`
            ).join('')}
          </div>
        </div>

        <!-- Ruletas Guardadas -->
        <div style="margin-top:1.25rem;">
          <h3 style="font-size:1rem; margin-bottom:0.5rem;"><i class="fa-solid fa-clipboard-list"></i> Tus Ruletas Guardadas (${cachedRoulettes.length})</h3>
          ${
            cachedRoulettes.length === 0
              ? '<p class="text-muted" style="font-size:0.9rem;">No tienes ruletas personalizadas creadas aún. Puedes usar las plantillas rápidas de arriba o crear una nueva abajo.</p>'
              : `<div style="display:flex; flex-direction:column; gap:0.5rem; max-height:220px; overflow-y:auto; padding-right:0.25rem;">
                  ${cachedRoulettes
                    .map(r => {
                      const isActive = activeRoulette?.id === r.id;
                      return `
                        <div class="stat-box ${isActive ? 'roulette-item-active' : ''}" style="display:flex; justify-content:space-between; align-items:center; gap:0.5rem; padding:0.55rem 0.75rem;">
                          <div style="cursor:pointer;" data-action="select-roulette" data-id="${r.id}">
                            <div style="display:flex; align-items:center; gap:0.4rem;">
                              <strong>${escapeHtml(r.name)}</strong>
                              ${isActive ? '<span class="badge badge-success" style="font-size:0.7rem;"><i class="fa-solid fa-bullseye"></i> En Pantalla</span>' : ''}
                            </div>
                            <div class="text-muted" style="font-size:0.82rem;">${r.options.map(escapeHtml).join(' · ')}</div>
                          </div>
                          <div style="display:flex; gap:0.35rem; align-items:center;">
                            ${
                              !isActive
                                ? `<button type="button" class="btn btn-sm" data-action="select-roulette" data-id="${r.id}" title="Cargar en la ruleta"><i class="fa-solid fa-arrows-rotate"></i> Cargar</button>`
                                : ''
                            }
                            <button type="button" class="btn btn-sm btn-primary" data-action="spin-specific-roulette" data-id="${r.id}" title="Girar esta ruleta"><i class="fa-solid fa-dice"></i></button>
                            <button type="button" class="btn btn-sm btn-danger" data-action="delete-roulette" data-id="${r.id}" title="Eliminar ruleta"><i class="fa-solid fa-xmark"></i></button>
                          </div>
                        </div>`;
                    })
                    .join('')}
                </div>`
          }
        </div>

        <!-- Formulario: Nueva Ruleta -->
        <form id="form-new-roulette" style="margin-top:1.25rem; padding-top:1rem; border-top:1px solid var(--border);">
          <h3 style="font-size:1rem; margin-bottom:0.5rem;"><i class="fa-solid fa-plus"></i> Crear Nueva Ruleta</h3>
          <div class="field">
            <label for="roul-name">Nombre de la ruleta *</label>
            <input type="text" id="roul-name" name="name" placeholder="Ej: ¿Qué película vemos?, ¿Quién cocina hoy?" required>
          </div>
          <div class="field">
            <label for="roul-opts">Opciones separadas por coma * (mínimo 2)</label>
            <input type="text" id="roul-opts" name="options" placeholder="Ej: Comedia, Terror, Acción, Serie, Animación" required>
          </div>
          <button type="submit" class="btn btn-primary">Guardar y Cargar en la Ruleta</button>
        </form>
      </section>

      <!-- Columna 2: Planes Aleatorios de la Semana + IA -->
      <section class="card">
        <h2><i class="fa-solid fa-wand-magic-sparkles" style="color:var(--brand);"></i> Planes Aleatorios de la Semana + IA</h2>
        <div class="stat-box" style="margin-block-end:1rem; border-color:var(--brand);">
          <div class="text-muted">Plan elegido para esta semana:</div>
          <div class="stat-value" style="font-size:1.2rem;">
            ${selectedPlan ? `<i class="fa-solid fa-star" style="color:#f59e0b;"></i> ${escapeHtml(selectedPlan.title)} (${escapeHtml(selectedPlan.category)})` : 'Aún no sortearon el plan de la semana'}
          </div>
          <div style="display:flex; gap:0.5rem; flex-wrap:wrap; margin-top:0.6rem;">
            <button type="button" class="btn btn-sm btn-primary" data-action="pick-random-plan"><i class="fa-solid fa-dice"></i> Sortear Plan Aleatorio</button>
            <button type="button" class="btn btn-sm btn-primary" data-action="generate-ai-plans"><i class="fa-solid fa-robot"></i> Proponer Planes con IA (SpiderIA / Gustos)</button>
          </div>
        </div>

        <form id="form-new-plan" style="display:grid; grid-template-columns: 2fr 1fr auto; gap:0.4rem; margin-block-end:1rem;">
          <input type="text" name="title" placeholder="Proponer nuevo plan semanal *" aria-label="Título del plan" required>
          <input type="text" name="weather" placeholder="Clima ideal" aria-label="Clima ideal">
          <button type="submit" class="btn btn-primary"><i class="fa-solid fa-plus"></i> Añadir</button>
        </form>

        <ul style="list-style:none; padding:0; margin:0; max-height:420px; overflow-y:auto; display:flex; flex-direction:column; gap:0.4rem;">
          ${plans
            .map(
              p => `<li class="stat-box" style="padding:0.5rem 0.75rem; display:flex; justify-content:space-between; align-items:center;">
                <span>
                  <span class="badge">${p.source === 'ai' ? '<i class="fa-solid fa-robot"></i> IA' : p.source === 'system' ? '<i class="fa-solid fa-star"></i> Sistema' : '<i class="fa-solid fa-heart"></i> Pareja'}</span>
                  <strong>${escapeHtml(p.title)}</strong> <small class="text-muted">(${escapeHtml(p.weather)})</small>
                </span>
                ${p.couple_id ? `<button type="button" class="btn btn-sm btn-danger" data-action="delete-plan" data-id="${p.id}"><i class="fa-solid fa-xmark"></i></button>` : ''}
              </li>`
            )
            .join('')}
        </ul>
      </section>
    </div>
  `;

  // Inicializar dibujado del lienzo tras la inserción en el DOM
  const canvas = document.getElementById('roulette-canvas');
  if (canvas) {
    drawWheel(canvas, activeOpts, currentWheelAngle);
  }
}

export default {
  id: 'tools',
  render: renderToolsTab,
  unmount: () => {
    if (animFrameId) {
      cancelAnimationFrame(animFrameId);
      animFrameId = null;
    }
    isSpinning = false;
  },
  actions: {
    'spin-active-roulette': (ctx) => {
      const canvas = document.getElementById('roulette-canvas');
      const opts = activeRoulette?.options || PRESETS[0].options;
      if (canvas && opts.length >= 2) {
        spinWheel(canvas, opts, winner => {
          ctx.showStatus(`¡La ruleta eligió: ${winner}!`);
        });
      }
    },
    'spin-specific-roulette': (ctx, el) => {
      const id = Number(el.dataset.id);
      const target = cachedRoulettes.find(r => r.id === id);
      if (!target) return;
      activeRoulette = target;

      const canvas = document.getElementById('roulette-canvas');
      if (canvas) {
        drawWheel(canvas, target.options, currentWheelAngle);
        spinWheel(canvas, target.options, winner => {
          ctx.showStatus(`¡La ruleta "${target.name}" eligió: ${winner}!`);
        });
      }
    },
    'select-roulette': async (ctx, el) => {
      const id = Number(el.dataset.id || el.closest('[data-id]')?.dataset.id);
      const target = cachedRoulettes.find(r => r.id === id);
      if (target) {
        activeRoulette = target;
        await ctx.refresh();
      }
    },
    'apply-preset': (ctx, el) => {
      const idx = Number(el.dataset.presetIdx);
      const preset = PRESETS[idx];
      if (!preset) return;

      const nameInput = document.getElementById('roul-name');
      const optsInput = document.getElementById('roul-opts');
      if (nameInput && optsInput) {
        nameInput.value = preset.name;
        optsInput.value = preset.options.join(', ');
        nameInput.focus();
        nameInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    },
    'toggle-sound': (ctx) => {
      soundEnabled = !soundEnabled;
      localStorage.setItem('hifa_roulette_sound', String(soundEnabled));
      ctx.showStatus(soundEnabled ? 'Sonido de ruleta activado' : 'Sonido de ruleta silenciado');
      ctx.refresh();
    },
    'delete-roulette': async (ctx, el) => {
      const id = Number(el.dataset.id);
      await api(`/api/roulettes/${id}`, { method: 'DELETE' });
      if (activeRoulette?.id === id) {
        activeRoulette = null;
      }
      ctx.showStatus('Ruleta eliminada.');
      ctx.refresh();
    },
    'pick-random-plan': async (ctx) => {
      const res = await api('/api/plans/random', { method: 'POST' });
      ctx.showStatus(`Plan elegido: ${res.chosen.title}`);
      ctx.refresh();
    },
    'generate-ai-plans': async (ctx) => {
      ctx.showStatus('Generando planes personalizados con IA...');
      const res = await api('/api/plans/ai', { method: 'POST' });
      ctx.showStatus(`Se añadieron ${res.plans.length} planes propuestos por ${res.provider}.`);
      ctx.refresh();
    },
    'delete-plan': async (ctx, el) => {
      await api(`/api/plans/${el.dataset.id}`, { method: 'DELETE' });
      ctx.refresh();
    }
  },
  forms: {
    'form-new-roulette': async (ctx, data) => {
      const res = await api('/api/roulettes', { method: 'POST', body: data });
      const rawOpts = String(data.options || '').split(',').map(s => s.trim()).filter(Boolean);
      activeRoulette = {
        id: res.id,
        name: data.name,
        options: rawOpts
      };
      ctx.showStatus(`Ruleta "${data.name}" creada y cargada en pantalla.`);
      ctx.refresh();
    },
    'form-new-plan': async (ctx, data) => {
      await api('/api/plans', { method: 'POST', body: data });
      ctx.refresh();
    }
  }
};
