/** Read API JSON safely and identify misrouted Cloudflare Worker requests. */
export async function apiJson<T = any>(response: Response, endpoint: string): Promise<T> {
  const type = (response.headers.get('content-type') || '').toLowerCase();
  const body = await response.text();
  const trimmed = body.trimStart();
  const html = type.includes('text/html') || /^<!doctype\s+html/i.test(trimmed) || /^<html[\s>]/i.test(trimmed);
  if (html) {
    throw new Error(`${endpoint} returned HTML instead of JSON (HTTP ${response.status}). The Cloudflare Worker API may not be running on this website address. Check the Worker deployment, worker/index.js, wrangler.toml name and /api/ routing. Your unpublished resources have not been changed by this request.`);
  }
  if (!type.includes('json')) {
    throw new Error(`${endpoint} returned ${type || 'an unknown content type'} instead of JSON (HTTP ${response.status}). Check that the URL points to your active Cloudflare Worker.`);
  }
  let data: any;
  try { data = JSON.parse(body); }
  catch { throw new Error(`${endpoint} returned malformed JSON (HTTP ${response.status}). The server response could not be read.`); }
  if (!response.ok) {
    const detail = typeof data?.error === 'string' ? data.error : typeof data?.message === 'string' ? data.message : `HTTP ${response.status}`;
    throw new Error(`${endpoint} failed: ${detail} (HTTP ${response.status})${response.status === 401 ? '. Sign out and sign back in.' : ''}`);
  }
  return data as T;
}
