import { escapeHtml } from './utils.js';

export function renderMarkdown(md) {
  const lines = String(md || '').split('\n');
  const html = [];
  let inList = false;
  lines.forEach((rawLine, idx) => {
    const line = escapeHtml(rawLine);
    if (/^###\s+(.+)/.test(line)) {
      if (inList) { html.push('</ul>'); inList = false; }
      html.push(`<h4>${line.replace(/^###\s+/, '')}</h4>`);
    } else if (/^##\s+(.+)/.test(line)) {
      if (inList) { html.push('</ul>'); inList = false; }
      html.push(`<h3>${line.replace(/^##\s+/, '')}</h3>`);
    } else if (/^#\s+(.+)/.test(line)) {
      if (inList) { html.push('</ul>'); inList = false; }
      html.push(`<h2>${line.replace(/^#\s+/, '')}</h2>`);
    } else if (/^-\s+\[( |x|X)\]\s+(.+)/.test(line)) {
      if (!inList) { html.push('<ul style="list-style:none; padding-inline-start:0.5rem;">'); inList = true; }
      const m = line.match(/^-\s+\[( |x|X)\]\s+(.+)/);
      const checked = m[1].toLowerCase() === 'x' ? 'checked' : '';
      html.push(`<li><label style="font-weight:400;"><input type="checkbox" data-md-line="${idx}" ${checked}> ${formatInlineMd(m[2])}</label></li>`);
    } else if (/^-\s+(.+)/.test(line)) {
      if (!inList) { html.push('<ul>'); inList = true; }
      html.push(`<li>${formatInlineMd(line.replace(/^-\s+/, ''))}</li>`);
    } else if (/^&gt;\s*(.+)/.test(line)) {
      if (inList) { html.push('</ul>'); inList = false; }
      html.push(`<blockquote style="border-inline-start:3px solid var(--brand); margin:0.5rem 0; padding-inline-start:0.75rem;">${formatInlineMd(line.replace(/^&gt;\s*/, ''))}</blockquote>`);
    } else if (line.trim() === '') {
      if (inList) { html.push('</ul>'); inList = false; }
    } else {
      if (inList) { html.push('</ul>'); inList = false; }
      html.push(`<p style="margin:0.4rem 0;">${formatInlineMd(line)}</p>`);
    }
  });
  if (inList) html.push('</ul>');
  return html.join('\n');
}

export function formatInlineMd(text) {
  return text
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" loading="lazy">')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
}
