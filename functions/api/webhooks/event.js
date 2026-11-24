import { json, adminCheck, kvMissing, KEY_PREFIX } from '../../_lib/webhooks.js';

// GET /api/webhooks/event?key=evt:...   (header: x-admin-password) -> the full stored payload
export async function onRequestGet({ request, env }) {
  const auth = adminCheck(request, env);
  if (!auth.ok) return auth.res;
  if (!env.WEBHOOKS_KV) return kvMissing();

  const key = new URL(request.url).searchParams.get('key') || '';
  if (!key.startsWith(KEY_PREFIX) || key.length > 80) return json({ error: 'Invalid key' }, 400);

  const value = await env.WEBHOOKS_KV.get(key, 'json');
  if (!value) return json({ error: 'Event not found (it may have expired)' }, 404);
  return json(value);
}
