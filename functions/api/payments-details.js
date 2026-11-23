import { adyen, json, envError } from '../_lib/adyen.js';

// POST /api/payments-details { data: { details, paymentData } }
// Called after a QR scan, a bank redirect (FPX), an e-wallet redirect or a 3D Secure step.
export async function onRequestPost({ request, env }) {
  const bad = envError(env);
  if (bad) return bad;

  const { data = {} } = await request.json();
  const body = { details: data.details };
  if (data.paymentData) body.paymentData = data.paymentData;

  const r = await adyen(env, 'POST', '/payments/details', body);
  if (!r.ok) return json({ error: r.data.message || 'Payment details request failed', details: r.data }, 502);

  const d = r.data;
  return json({
    resultCode: d.resultCode,
    action: d.action,
    order: d.order,
    donationToken: d.donationToken,
    pspReference: d.pspReference,
    refusalReason: d.refusalReason,
    merchantReference: d.merchantReference,
  });
}
