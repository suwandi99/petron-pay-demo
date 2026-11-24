import { json, adminCheck, kvMissing, KEY_PREFIX } from '../../_lib/webhooks.js';

// POST /api/webhooks/clear   (header: x-admin-password) -> deletes all stored webhook events
export async function onRequestPost({ request, env }) {
  const auth = adminCheck(request, env);
  if (!auth.ok) return auth.res;
  if (!env.WEBHOOKS_KV) return kvMissing();

  let deleted = 0;
  let cursor;
  for (let page = 0; page < 5; page++) {
    const res = await env.WEBHOOKS_KV.list({ prefix: KEY_PREFIX, limit: 1000, cursor });
    await Promise.all(res.keys.map((k) => env.WEBHOOKS_KV.delete(k.name)));
    deleted += res.keys.length;
    if (res.list_complete) break;
    cursor = res.cursor;
  }
  return json({ ok: true, deleted });
}
