// Helpers for the Adyen webhook receiver and its back office.
// Storage is a Cloudflare KV namespace bound to the Pages project as WEBHOOKS_KV.

const enc = new TextEncoder();

export const KEY_PREFIX = 'evt:';

export function text(body, status = 200, extra = {}) {
  return new Response(body, { status, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', ...extra } });
}
export function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
}

// Constant-time string comparison.
export function safeEqual(a, b) {
  const x = enc.encode(String(a));
  const y = enc.encode(String(b));
  let diff = x.length ^ y.length;
  const n = Math.max(x.length, y.length);
  for (let i = 0; i < n; i++) diff |= (x[i] || 0) ^ (y[i] || 0);
  return diff === 0;
}

function hexToBytes(hex) {
  const clean = String(hex || '').trim();
  if (!clean || clean.length % 2 || !/^[0-9a-fA-F]+$/.test(clean)) return null;
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

// ADYEN_HMAC_KEY may hold one key or several, comma separated (each Adyen webhook has its own key unless reused).
export function hmacKeys(env) {
  return String(env.ADYEN_HMAC_KEY || '')
    .split(',')
    .map(hexToBytes)
    .filter(Boolean);
}

async function hmacBase64(keyBytes, message) {
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const msg = typeof message === 'string' ? enc.encode(message) : message;
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, msg));
  let bin = '';
  for (const b of sig) bin += String.fromCharCode(b);
  return btoa(bin);
}

const esc = (v) => String(v ?? '').replace(/\\/g, '\\\\').replace(/:/g, '\\:');

// Standard webhooks: the signed string is built from eight fields (see Adyen "Verify HMAC signatures").
export function standardSignedString(item) {
  return [
    item.pspReference,
    item.originalReference,
    item.merchantAccountCode,
    item.merchantReference,
    item.amount?.value,
    item.amount?.currency,
    item.eventCode,
    item.success,
  ]
    .map(esc)
    .join(':');
}

// -> 'valid' | 'invalid' | 'no-signature' | 'no-key'
export async function verifyStandard(item, keys) {
  if (!keys.length) return 'no-key';
  const given = item.additionalData?.hmacSignature;
  if (!given) return 'no-signature';
  const msg = standardSignedString(item);
  for (const k of keys) if (safeEqual(await hmacBase64(k, msg), given)) return 'valid';
  return 'invalid';
}

// Other JSON webhooks (e.g. recurring token events): HMAC of the raw body, sent in the hmacsignature header.
export async function verifyRawBody(rawBytes, headerValue, keys) {
  if (!keys.length) return 'no-key';
  if (!headerValue) return 'no-signature';
  for (const k of keys) if (safeEqual(await hmacBase64(k, rawBytes), headerValue)) return 'valid';
  return 'invalid';
}

const clip = (v, n = 64) => (v === undefined || v === null ? undefined : String(v).slice(0, n));

// Small summary stored as KV metadata (limit is 1 KB) so the list view needs no extra reads.
export function summariseStandard(item, sig) {
  return {
    fmt: 'standard',
    code: clip(item.eventCode),
    ok: item.success === 'true' ? true : item.success === 'false' ? false : null,
    psp: clip(item.pspReference, 24),
    orig: clip(item.originalReference, 24),
    ref: clip(item.merchantReference, 48),
    mid: clip(item.merchantAccountCode, 40),
    v: Number.isFinite(Number(item.amount?.value)) ? Number(item.amount.value) : undefined,
    cur: clip(item.amount?.currency, 3),
    pm: clip(item.paymentMethod, 24),
    reason: clip(item.reason, 60),
    ev: clip(item.eventDate, 32),
    live: item.live === 'true' || item.live === true || undefined,
    sig,
  };
}

export function summariseJson(body, sig) {
  const d = body.data || {};
  return {
    fmt: 'json',
    code: clip(body.type, 48),
    ok: null,
    psp: clip(body.eventId || d.id || d.storedPaymentMethodId, 40),
    ref: clip(d.shopperReference, 48),
    mid: clip(d.merchantAccount, 40),
    ev: clip(body.createdAt, 32),
    sig,
  };
}

export function ttlSeconds(env) {
  const days = Math.min(Math.max(Number(env.WEBHOOK_TTL_DAYS) || 7, 1), 90);
  return Math.round(days * 86400);
}

// Newest-first key ordering: KV lists keys alphabetically, so use a reversed timestamp.
export function newKey() {
  const rev = String(9999999999999 - Date.now()).padStart(13, '0');
  return `${KEY_PREFIX}${rev}:${crypto.randomUUID().slice(0, 8)}`;
}

// Back office password: WEBHOOK_VIEW_PASSWORD (falls back to POS_PIN). Secure by default.
export function adminCheck(request, env) {
  const pw = env.WEBHOOK_VIEW_PASSWORD || env.POS_PIN;
  if (!pw) {
    return { ok: false, res: json({ error: 'Set WEBHOOK_VIEW_PASSWORD in Cloudflare (Settings → Variables and secrets) to open the back office.', code: 'no-password' }, 503) };
  }
  if (!safeEqual(request.headers.get('x-admin-password') || '', pw)) {
    return { ok: false, res: json({ error: 'Wrong or missing password', code: 'auth' }, 401) };
  }
  return { ok: true };
}

export function kvMissing() {
  return json({ error: 'The KV namespace is not bound. Add a KV binding named WEBHOOKS_KV to this Pages project, then redeploy.', code: 'no-kv' }, 500);
}
