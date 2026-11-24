import { json, adminCheck, hmacKeys, kvMissing, KEY_PREFIX } from '../../_lib/webhooks.js';

// GET /api/webhooks/list?limit=200&cursor=...   (header: x-admin-password)
export async function onRequestGet({ request, env }) {
  const auth = adminCheck(request, env);
  if (!auth.ok) return auth.res;
  if (!env.WEBHOOKS_KV) return kvMissing();

  const url = new URL(request.url);
  const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit'), 10) || 200, 1), 1000);
  const cursor = url.searchParams.get('cursor') || undefined;

  const res = await env.WEBHOOKS_KV.list({ prefix: KEY_PREFIX, limit, cursor });
  return json({
    events: res.keys.map((k) => ({ key: k.name, ...(k.metadata || {}) })),
    cursor: res.list_complete ? null : res.cursor,
    config: {
      hmacKeysConfigured: hmacKeys(env).length,
      basicAuthConfigured: Boolean(env.WEBHOOK_USER || env.WEBHOOK_PASSWORD),
      retentionDays: Math.min(Math.max(Number(env.WEBHOOK_TTL_DAYS) || 7, 1), 90),
    },
  });
}
