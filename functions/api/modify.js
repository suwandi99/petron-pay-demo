import { adyen, json, envError, checkAmount, checkPin, CURRENCY } from '../_lib/adyen.js';

// POST /api/modify  - merchant-side actions on a pre-authorised payment (Station POS).
//   { action: 'capture',     pspReference, amount }                 capture <= authorised amount (partial or full)
//   { action: 'adjust',      pspReference, amount }                 change the authorised total (/amountUpdates)
//   { action: 'overcapture', pspReference, amount }                 raise the hold to `amount`, then capture it
//   { action: 'cancel',      pspReference }                         release the hold
//
// Note: Adyen's docs describe capturing up to the authorised amount. "Over capture" here is done the
// documented way for fuel: adjust the pre-authorisation upwards first, then capture the new total.
// Adjustments and captures are processed asynchronously; the final result arrives as webhooks
// (AUTHORISATION_ADJUSTMENT, CAPTURE). This demo does not receive webhooks.

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function onRequestPost({ request, env }) {
  const bad = envError(env);
  if (bad) return bad;
  if (!checkPin(request, env)) return json({ error: 'Wrong or missing POS PIN' }, 401);

  const { action, pspReference, amount } = await request.json();
  if (!/^[A-Za-z0-9]{12,20}$/.test(String(pspReference || ''))) return json({ error: 'Invalid pspReference' }, 400);

  const money = (v) => ({ currency: CURRENCY, value: v });
  const ref = (p) => `${p}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const calls = [];

  const call = async (name, path, body) => {
    const r = await adyen(env, 'POST', `/payments/${pspReference}${path}`, body);
    calls.push({ name, endpoint: r.url, request: body, status: r.status, response: r.data });
    return r;
  };
  const fail = (r) =>
    json({ ok: false, error: r.data?.message || r.data?.errorCode || 'Adyen rejected the request', calls }, 502);

  if (action === 'cancel') {
    const r = await call('Release hold', '/cancels', {
      merchantAccount: env.ADYEN_MERCHANT_ACCOUNT,
      reference: ref('release'),
    });
    return r.ok ? json({ ok: true, calls }) : fail(r);
  }

  const value = checkAmount(amount, 'modify');
  if (value === null) return json({ error: 'Invalid amount' }, 400);

  if (action === 'capture') {
    const r = await call('Capture', '/captures', {
      merchantAccount: env.ADYEN_MERCHANT_ACCOUNT,
      amount: money(value),
      reference: ref('capture'),
    });
    return r.ok ? json({ ok: true, calls }) : fail(r);
  }

  if (action === 'adjust') {
    const r = await call('Adjust authorisation', '/amountUpdates', {
      merchantAccount: env.ADYEN_MERCHANT_ACCOUNT,
      amount: money(value),
      reference: ref('adjust'),
    });
    return r.ok ? json({ ok: true, calls }) : fail(r);
  }

  if (action === 'overcapture') {
    const a = await call('Adjust authorisation (increase hold)', '/amountUpdates', {
      merchantAccount: env.ADYEN_MERCHANT_ACCOUNT,
      amount: money(value),
      reference: ref('adjust'),
    });
    if (!a.ok) return fail(a);
    await sleep(2500); // give the adjustment a moment before capturing (async in Adyen)
    const c = await call('Capture (new total)', '/captures', {
      merchantAccount: env.ADYEN_MERCHANT_ACCOUNT,
      amount: money(value),
      reference: ref('capture'),
    });
    return c.ok ? json({ ok: true, calls }) : fail(c);
  }

  return json({ error: 'Unknown action' }, 400);
}
