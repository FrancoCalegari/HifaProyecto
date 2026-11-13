import { api } from './api.js';

export async function fileToUploadedUrl(fileInput) {
  const file = fileInput?.files?.[0];
  if (!file) return '';
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
  const res = await api('/api/upload', {
    method: 'POST',
    body: { filename: file.name, dataUrl }
  });
  return res.url || '';
}

export async function filesToUploadedMedia(fileInput) {
  const files = Array.from(fileInput?.files || []);
  if (files.length === 0) return [];
  const uploaded = [];
  for (const file of files) {
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    const res = await api('/api/upload', {
      method: 'POST',
      body: { filename: file.name, dataUrl }
    });
    if (res && res.url) {
      uploaded.push({
        url: res.url,
        type: String(file.type || '').startsWith('video/') ? 'video' : 'image',
        name: file.name
      });
    }
  }
  return uploaded;
}
