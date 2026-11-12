import { state } from '../core/state.js';
import { api } from '../core/api.js';
import { escapeHtml } from '../core/utils.js';

/* ================= FASE 1: VINCULACIÓN Y FORMULARIO DE PAREJA ================= */
function renderCoupleTab(container) {
  const urlPair = new URLSearchParams(window.location.search).get('pair') || '';
  if (!state.user.couple_id) {
    const shareLink = `${window.location.origin}/?pair=${encodeURIComponent(state.user.pair_code)}`;
    container.innerHTML = `
      <div class="grid-2">
        <section class="card" aria-labelledby="share-code-title">
          <h2 id="share-code-title">1. Comparte tu código o link de pareja</h2>
          <p class="text-muted">Uno de los dos crea o comparte este código y el otro se vincula ingresándolo.</p>
          <div class="stat-box" style="margin-block-end:1rem;">
            <div class="text-muted">Tu código único</div>
            <div class="stat-value" id="my-pair-code">${escapeHtml(state.user.pair_code)}</div>
            <p class="text-muted" style="word-break:break-all; margin-block:0.4rem;">Link: <code>${escapeHtml(shareLink)}</code></p>
          </div>
          <div style="display:flex; gap:0.6rem; flex-wrap:wrap;">
            <button type="button" class="btn btn-primary" data-action="copy-pair-link" data-link="${escapeHtml(shareLink)}"><i class="fa-solid fa-copy"></i> Copiar Link de Invitación</button>
            <button type="button" class="btn" data-action="regenerate-pair-code"><i class="fa-solid fa-arrows-rotate"></i> Generar Nuevo Código</button>
          </div>
        </section>

        <section class="card" aria-labelledby="join-code-title">
          <h2 id="join-code-title">2. Vincularme con el código de mi pareja</h2>
          <form id="form-link-couple">
            <div class="field">
              <label for="input-pair-code">Código de tu pareja *</label>
              <input type="text" id="input-pair-code" name="code" value="${escapeHtml(urlPair)}" placeholder="Ej: HIFA-A1B2C3" autocorrect="off" autocapitalize="characters" spellcheck="false" required>
            </div>
            <button type="submit" class="btn btn-primary"><i class="fa-solid fa-heart"></i> Vincularnos ahora</button>
          </form>
        </section>
      </div>
    `;
    return;
  }

  const relStart = state.couple?.relationship_start || '';
  let daysTogetherText = 'Completa la fecha de inicio de su relación abajo (obligatorio).';
  if (relStart) {
    const diffMs = Date.now() - new Date(relStart + 'T00:00:00').getTime();
    const days = Math.max(0, Math.floor(diffMs / 86400000));
    daysTogetherText = `Llevan ${days} días juntos desde el ${relStart} <i class="fa-solid fa-heart" style="color:var(--brand);"></i>`;
  }

  const myT = state.user.tastes || {};
  const paT = state.partner?.tastes || {};

  container.innerHTML = `
    <section class="card">
      <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:1rem;">
        <div>
          <h2 style="margin:0;"><i class="fa-solid fa-heart"></i> Información y Gustos de la Pareja</h2>
          <p class="text-muted" style="margin:0.25rem 0 0 0;">${escapeHtml(daysTogetherText)}</p>
        </div>
        <span class="badge">Pareja #${state.couple.id}</span>
      </div>
    </section>

    <form id="form-couple-profile" class="card">
      <h3>Formulario de la Pareja</h3>
      <div class="grid-2">
        <div class="field">
          <label for="rel-start-date">¿Cuándo inició su relación? (Obligatorio) *</label>
          <input type="date" id="rel-start-date" name="relationship_start" value="${escapeHtml(relStart)}" required>
        </div>
        <div class="field">
          <label for="shared-anniversary-note">Lema, canción o acuerdo compartido en pareja</label>
          <input type="text" id="shared-anniversary-note" name="shared_motto" value="${escapeHtml(state.couple?.shared_info?.motto || '')}" placeholder="Ej: Nuestro lugar favorito, metas juntos...">
        </div>
      </div>

      <p class="text-muted">
        Tu formulario: ${state.user.profile_completed ? '<strong class="text-ok"><i class="fa-solid fa-check"></i> guardado</strong>' : '<strong>pendiente</strong>'} ·
        ${escapeHtml(state.partner?.first_name || 'Tu pareja')}: ${state.partner?.profile_completed ? '<strong class="text-ok"><i class="fa-solid fa-check"></i> guardado</strong>' : '<strong>pendiente</strong>'}
      </p>
      <div class="grid-2">
        ${renderTastesFieldset('me', `Mis Gustos y Talles (${state.user.first_name})`, myT)}
        ${state.partner?.profile_completed ? renderPartnerReadonly(paT) : `<fieldset><legend>${escapeHtml(state.partner?.first_name || 'Tu pareja')}</legend><p class="text-muted">Cada uno completa su propia información. Verás la de tu pareja cuando la guarde.</p></fieldset>`}
      </div>

      <button type="submit" class="btn btn-primary"><i class="fa-solid fa-floppy-disk"></i> Guardar Información de la Pareja</button>
    </form>
  `;
}

function renderPartnerReadonly(t) {
  const rows = [
    ['Remera', t.shirt_size], ['Pantalón', t.pants_size], ['Calzado', t.shoe_size], ['Abrigo/Vestido', t.coat_size],
    ['Comida', t.favorite_food], ['Flores', t.favorite_flowers], ['Marcas', t.favorite_brands],
    ['Series/Pelis', t.favorite_series_movies], ['Color', t.favorite_color], ['Clima', t.favorite_weather],
    ['Plan', t.favorite_plan], ['Extras', t.additional_tastes]
  ].filter(r => r[1]);
  return `<fieldset><legend>Info de ${escapeHtml(state.partner.first_name)}</legend>
    <dl style="margin:0; display:grid; grid-template-columns:auto 1fr; gap:0.35rem 0.8rem;">
      ${rows.map(([k, v]) => `<dt class="text-muted">${k}</dt><dd style="margin:0;">${escapeHtml(v)}</dd>`).join('')}
    </dl></fieldset>`;
}

function renderTastesFieldset(prefix, legendTitle, t) {
  return `
    <fieldset>
      <legend>${escapeHtml(legendTitle)}</legend>
      <div class="grid-2">
        <div class="field">
          <label for="${prefix}-shirt">Talle Remera / Camisa</label>
          <input type="text" id="${prefix}-shirt" name="${prefix}_shirt_size" value="${escapeHtml(t.shirt_size || '')}" placeholder="Ej: M / L">
        </div>
        <div class="field">
          <label for="${prefix}-pants">Talle Pantalón</label>
          <input type="text" id="${prefix}-pants" name="${prefix}_pants_size" value="${escapeHtml(t.pants_size || '')}" placeholder="Ej: 40 / M">
        </div>
        <div class="field">
          <label for="${prefix}-shoes">Talle Calzado</label>
          <input type="text" id="${prefix}-shoes" name="${prefix}_shoe_size" value="${escapeHtml(t.shoe_size || '')}" placeholder="Ej: 38 / 42">
        </div>
        <div class="field">
          <label for="${prefix}-coat">Talle Abrigo / Vestido</label>
          <input type="text" id="${prefix}-coat" name="${prefix}_coat_size" value="${escapeHtml(t.coat_size || '')}" placeholder="Ej: L">
        </div>
      </div>
      <div class="field">
        <label for="${prefix}-food">Comida favorita</label>
        <input type="text" id="${prefix}-food" name="${prefix}_favorite_food" value="${escapeHtml(t.favorite_food || '')}" placeholder="Ej: Ñoquis, Sushi, Milanesas">
      </div>
      <div class="field">
        <label for="${prefix}-flowers">Flores favoritas</label>
        <input type="text" id="${prefix}-flowers" name="${prefix}_favorite_flowers" value="${escapeHtml(t.favorite_flowers || '')}" placeholder="Ej: Girasoles, Tulipanes, Rosas">
      </div>
      <div class="field">
        <label for="${prefix}-brands">Marcas favoritas</label>
        <input type="text" id="${prefix}-brands" name="${prefix}_favorite_brands" value="${escapeHtml(t.favorite_brands || '')}" placeholder="Ej: Nike, Zara, Adidas">
      </div>
      <div class="field">
        <label for="${prefix}-movies">Series o películas favoritas</label>
        <input type="text" id="${prefix}-movies" name="${prefix}_favorite_series_movies" value="${escapeHtml(t.favorite_series_movies || '')}" placeholder="Ej: Interstellar, Breaking Bad">
      </div>
      <div class="grid-2">
        <div class="field">
          <label for="${prefix}-color">Color favorito</label>
          <input type="text" id="${prefix}-color" name="${prefix}_favorite_color" value="${escapeHtml(t.favorite_color || '')}" placeholder="Ej: Azul marino, Lila">
        </div>
        <div class="field">
          <label for="${prefix}-weather">Clima favorito</label>
          <input type="text" id="${prefix}-weather" name="${prefix}_favorite_weather" value="${escapeHtml(t.favorite_weather || '')}" placeholder="Ej: Días de lluvia / Templado">
        </div>
      </div>
      <div class="field">
        <label for="${prefix}-plan">Plan favorito</label>
        <input type="text" id="${prefix}-plan" name="${prefix}_favorite_plan" value="${escapeHtml(t.favorite_plan || '')}" placeholder="Ej: Merienda y paseo, cine en casa">
      </div>
      <div class="field">
        <label for="${prefix}-extra">Gustos adicionales (alergias, snacks, perfumes, etc.)</label>
        <textarea id="${prefix}-extra" name="${prefix}_additional_tastes" rows="2">${escapeHtml(t.additional_tastes || '')}</textarea>
      </div>
    </fieldset>
  `;
}

export default {
  id: 'couple',
  render: renderCoupleTab,
  actions: {
    'copy-pair-link': async (ctx, el) => {
      await navigator.clipboard?.writeText(el.dataset.link);
      ctx.showStatus('Link copiado al portapapeles.');
    },
    'regenerate-pair-code': async (ctx) => {
      const res = await api('/api/couple/code', { method: 'POST' });
      state.user.pair_code = res.pair_code;
      ctx.refresh();
    }
  },
  forms: {
    'form-link-couple': async (ctx, data) => {
      await api('/api/couple/link', { method: 'POST', body: data });
      ctx.showStatus('¡Vinculación exitosa! Ahora completen los datos de su relación.');
      return ctx.bootstrap();
    },
    'form-couple-profile': async (ctx, data) => {
      const extractTastes = prefix => ({
        shirt_size: data[`${prefix}_shirt_size`] || '',
        pants_size: data[`${prefix}_pants_size`] || '',
        shoe_size: data[`${prefix}_shoe_size`] || '',
        coat_size: data[`${prefix}_coat_size`] || '',
        favorite_food: data[`${prefix}_favorite_food`] || '',
        favorite_flowers: data[`${prefix}_favorite_flowers`] || '',
        favorite_brands: data[`${prefix}_favorite_brands`] || '',
        favorite_series_movies: data[`${prefix}_favorite_series_movies`] || '',
        favorite_color: data[`${prefix}_favorite_color`] || '',
        favorite_weather: data[`${prefix}_favorite_weather`] || '',
        favorite_plan: data[`${prefix}_favorite_plan`] || '',
        additional_tastes: data[`${prefix}_additional_tastes`] || ''
      });
      const res = await api('/api/couple/profile', {
        method: 'PUT',
        body: {
          relationship_start: data.relationship_start,
          shared_info: { motto: data.shared_motto || '' },
          my_tastes: extractTastes('me')
        }
      });
      ctx.showStatus(res.profiles_ready ? '¡Ambos guardaron! Ya puedes ver el dashboard.' : 'Guardado. Falta que tu pareja complete el suyo.');
      if (res.profiles_ready) state.activeTab = 'dashboard';
      return ctx.bootstrap();
    }
  }
};
