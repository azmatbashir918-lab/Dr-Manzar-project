let csrfToken = '';
export const setCsrf = value => { csrfToken = value || ''; };
export async function api(path, { method = 'GET', body, signal } = {}) {
  let response;
  try {
    response = await fetch('/api/v1' + path, { method, credentials: 'include', signal,
      headers: { ...(body && !(body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
        ...(!['GET', 'HEAD'].includes(method) && csrfToken ? { 'X-CSRF-Token': csrfToken } : {}) },
      body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
    });
  } catch (error) { if (error.name === 'AbortError') throw error; throw new Error('Cannot reach the server. Please try again shortly.'); }
  if (response.status === 204) return null;
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = data?.error?.issues?.map(i => `${i.path?.join('.') || 'Content'}: ${i.message}`).join(' · ');
    const error = new Error(detail || data?.error?.message || 'The server is temporarily unavailable.');
    error.status = response.status; throw error;
  }
  return data;
}
export function safeMedia(value) {
  if (!value) return '';
  if (/^\/api\/v1\/media\/(covers|narration)\/[a-f0-9-]{36}\.(webp|mp3)$/.test(value)) return value;
  try { return new URL(value).protocol === 'https:' ? value : ''; } catch { return ''; }
}
