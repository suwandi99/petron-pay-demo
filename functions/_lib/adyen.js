// Shared helpers for the Cloudflare Pages Functions in /functions/api.
// The Adyen API key lives only here on the server side (Pages environment variable).
// This demo is hard-wired to the Adyen TEST environment on purpose.

export const CURRENCY = 'MYR';

// Amount limits in minor units (sen). Keeps a public demo URL from being abused.
export const LIMITS = {
  topup: { min: 100, max: 100000 }, // RM 1 - RM 1,000
  preauth: { min: 100, max: 50000 }, // RM 1 - RM 500
  addcard: { min: 0, max: 0 }, // zero-value auth to tokenise a card
  modify: { min: 1, max: 100000 }, // adjust / capture ceiling
};

export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

export function missingEnv(env) {
  return ['ADYEN_API_KEY', 'ADYEN_CLIENT_KEY', 'ADYEN_MERCHANT_ACCOUNT'].filter((k) => !env[k]);
}

export function envError(env) {
  const missing = missingEnv(env);
  if (!missing.length) return null;
  return json({ error: `Server is missing environment variables: ${missing.join(', ')}` }, 500);
}

export function checkAmount(value, kind) {
  const limits = LIMITS[kind];
  if (!limits) return null;
  if (!Number.isInteger(value) || value < limits.min || value > limits.max) return null;
  return value;
}

export async function adyen(env, method, path, body) {
  const version = env.CHECKOUT_API_VERSION || '72';
  const url = `https://checkout-test.adyen.com/v${version}${path}`;
  const headers = { 'x-api-key': env.ADYEN_API_KEY, 'content-type': 'application/json' };
  if (method !== 'GET') headers['Idempotency-Key'] = crypto.randomUUID();
  const res = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }
  return { ok: res.ok, status: res.status, data, url: `${method} /v${version}${path}` };
}

// Optional shared PIN protecting the Station POS actions (capture / adjust / cancel).
export function checkPin(request, env) {
  if (!env.POS_PIN) return true;
  return request.headers.get('x-pos-pin') === env.POS_PIN;
}
