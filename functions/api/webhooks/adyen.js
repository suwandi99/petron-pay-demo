import {
  hmacKeys, safeEqual, text, newKey, ttlSeconds, verifyStandard, verifyRawBody, summariseStandard, summariseJson,
} from '../../_lib/webhooks.js';

const MAX_BODY = 200_000; // bytes
const MAX_ITEMS = 50;

// POST /api/webhooks/adyen  <- configure this URL in Adyen Customer Area (Developers > Webhooks).
// Handles both formats: classic "standard" notifications ({ notificationItems: [...] }) and the newer
// JSON events such as recurring token life cycle ({ type, data, ... } signed in the hmacsignature header).
export async function onRequestPost({ request, env }) {
  if (!env.WEBHOOKS_KV) return text('WEBHOOKS_KV binding is missing on this Pages project', 500);

  // 1) Basic authentication (optional but recommended): same username/password as in the Adyen webhook.
  if (env.WEBHOOK_USER || env.WEBHOOK_PASSWORD) {
    let expected = '';
    try {
      expected = 'Basic ' + btoa(`${env.WEBHOOK_USER || ''}:${env.WEBHOOK_PASSWORD || ''}`);
    } catch {
      return text('Server basic-auth credentials must be plain ASCII', 500);
    }
    if (!safeEqual(request.headers.get('authorization') || '', expected)) {
      return text('Unauthorized', 401, { 'www-authenticate': 'Basic realm="adyen-webhook"' });
    }
  }

  // 2) Read the raw body (needed unmodified for header-signed events).
  const raw = new Uint8Array(await request.arrayBuffer());
  if (raw.length > MAX_BODY) return text('Payload too large', 413);
  let body;
  try {
    body = JSON.parse(new TextDecoder().decode(raw));
  } catch {
    return text('Body is not JSON. In the Adyen webhook settings set Method to JSON.', 400);
  }

  const keys = hmacKeys(env);
  const receivedAt = new Date().toISOString();
  const hdr = {
    hmacsignature: request.headers.get('hmacsignature') || undefined,
    protocol: request.headers.get('protocol') || undefined,
    'user-agent': request.headers.get('user-agent') || undefined,
    'content-type': request.headers.get('content-type') || undefined,
  };

  // 3) Build the list of events to store.
  const events = [];
  if (Array.isArray(body?.notificationItems)) {
    for (const entry of body.notificationItems.slice(0, MAX_ITEMS)) {
      const item = entry?.NotificationRequestItem;
      if (!item || typeof item !== 'object') continue;
      const sig = await verifyStandard(item, keys);
      const withLive = { ...item, live: body.live };
      events.push({ summary: summariseStandard(withLive, sig), payload: item, sig });
    }
  } else if (body && typeof body === 'object' && (body.type || body.data)) {
    const sig = await verifyRawBody(raw, hdr.hmacsignature, keys);
    events.push({ summary: summariseJson(body, sig), payload: body, sig });
  } else {
    events.push({ summary: { fmt: 'unknown', code: 'unrecognised', sig: 'no-key' }, payload: body, sig: 'not-checked' });
  }

  // 4) Store them (newest first, auto-expiring) and acknowledge.
  const ttl = ttlSeconds(env);
  await Promise.all(
    events.map((e) =>
      env.WEBHOOKS_KV.put(
        newKey(),
        JSON.stringify({ receivedAt, headers: hdr, signature: e.sig, payload: e.payload }),
        { expirationTtl: ttl, metadata: { ...e.summary, rt: receivedAt } }
      )
    )
  );

  // Adyen only needs a 2xx; "[accepted]" is the traditional body for standard webhooks.
  return text('[accepted]', 200);
}

// Browsers / uptime checks hitting the URL get a friendly note instead of a 404.
export async function onRequestGet() {
  return text('Adyen webhook endpoint is up. Adyen sends events here with HTTP POST.');
}
