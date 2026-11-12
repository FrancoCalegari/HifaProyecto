import { state } from './state.js';

export function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function formatMoney(amount) {
  const cur = state.user?.currency || 'ARS';
  const num = Number(amount || 0);
  try {
    return new Intl.NumberFormat('es-AR', { style: 'currency', currency: cur, maximumFractionDigits: 2 }).format(num);
  } catch {
    return `${cur} ${num.toFixed(2)}`;
  }
}

export function showStatus(msg, isError = false) {
  const banner = document.getElementById('status-banner');
  if (!banner) return;
  banner.innerHTML = `<div class="card" style="margin-block:0.75rem; padding:0.75rem 1rem; border-color:${isError ? 'var(--danger)' : 'var(--ok)'};">
    <strong class="${isError ? 'text-danger' : 'text-ok'}">${isError ? '⚠️ ' : '✓ '}${escapeHtml(msg)}</strong>
  </div>`;
  setTimeout(() => {
    if (banner.innerHTML.includes(escapeHtml(msg))) banner.innerHTML = '';
  }, 4500);
}

export function applyTheme(theme) {
  const root = document.documentElement;
  if (theme === 'light' || theme === 'dark') {
    root.setAttribute('data-theme', theme);
  } else {
    root.removeAttribute('data-theme');
  }
}
