function safeJson(str, fallback) {
  try {
    return str ? JSON.parse(str) : fallback;
  } catch {
    return fallback;
  }
}

function defaultAvatarSvg(name) {
  const initials = (name || 'HP')
    .split(/\s+/)
    .map(s => s[0] || '')
    .join('')
    .slice(0, 2)
    .toUpperCase();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120" viewBox="0 0 120 120"><rect width="120" height="120" rx="60" fill="#e11d48"/><text x="50%" y="54%" dominant-baseline="middle" text-anchor="middle" fill="#ffffff" font-family="sans-serif" font-size="44" font-weight="bold">${initials}</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.m4v': 'video/x-m4v',
  '.ogg': 'video/ogg',
  '.avi': 'video/x-msvideo'
};

function getOffsetDate(dateStr, offsetDays) {
  const d = new Date(dateStr + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

function computeMenstrualProjections(data) {
  const cycleDays = Number(data.cycleDays || 28);
  const periodDays = Number(data.periodDays || 5);
  let nextPeriodStart = '';
  let nextPeriodEnd = '';
  let ovulationDate = '';
  let fertileWindow = '';

  if (data.lastStart) {
    nextPeriodStart = getOffsetDate(data.lastStart, cycleDays);
    nextPeriodEnd = getOffsetDate(nextPeriodStart, periodDays - 1);
    ovulationDate = getOffsetDate(nextPeriodStart, -14);
    fertileWindow = `${getOffsetDate(ovulationDate, -4)} al ${getOffsetDate(ovulationDate, 1)}`;
  }
  return {
    ...data,
    cycleDays,
    periodDays,
    nextPeriodStart,
    nextPeriodEnd,
    ovulationDate,
    fertileWindow
  };
}

module.exports = { safeJson, getOffsetDate, computeMenstrualProjections, defaultAvatarSvg, MIME_TYPES };
