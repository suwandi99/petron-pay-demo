import { adyen, json, envError, checkAmount, CURRENCY } from '../_lib/adyen.js';

// Non-card methods offered for wallet top-up. Override with the TOPUP_METHODS env var
// (comma separated Adyen payment method types). Only methods that are actually enabled on
// your merchant account come back from Adyen, so the list can safely include extras.
//   duitnow                 DuitNow QR
//   molpay_ebanking_fpx_MY  FPX online banking
//   touchngo                Touch 'n Go eWallet
//   grabpay_MY              GrabPay Malaysia
//   molpay_boost            Boost
const DEFAULT_TOPUP_METHODS = 'duitnow,molpay_ebanking_fpx_MY,touchngo,grabpay_MY,molpay_boost';

// POST /api/payment-methods { scope: 'topup' | 'card' | 'addcard', amount: { value }, shopperReference }
export async function onRequestPost({ request, env }) {
  const bad = envError(env);
  if (bad) return bad;

  const { scope = 'card', amount, shopperReference } = await request.json();
  const kind = scope === 'topup' ? 'topup' : scope === 'addcard' ? 'addcard' : 'preauth';
  const value = checkAmount(amount?.value, kind);
  if (value === null) return json({ error: 'Invalid amount' }, 400);

  const r = await adyen(env, 'POST', '/paymentMethods', {
    merchantAccount: env.ADYEN_MERCHANT_ACCOUNT,
    countryCode: 'MY',
    shopperLocale: 'en-US',
    channel: 'Web',
    amount: { currency: CURRENCY, value },
    shopperReference: String(shopperReference || '').slice(0, 64) || undefined,
  });
  if (!r.ok) return json({ error: r.data.message || 'Could not load payment methods', details: r.data }, 502);

  const all = r.data.paymentMethods || [];
  let paymentMethods;
  let storedPaymentMethods = r.data.storedPaymentMethods || [];

  if (scope === 'topup') {
    const allowed = (env.TOPUP_METHODS || DEFAULT_TOPUP_METHODS)
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    // Cards are always offered for top-up too (set TOPUP_CARDS=off to hide them).
    if (String(env.TOPUP_CARDS || '').toLowerCase() !== 'off' && !allowed.includes('scheme')) allowed.push('scheme');
    paymentMethods = all.filter((m) => allowed.includes(String(m.type).toLowerCase()));
    // Saved cards are kept (Adyen returns them for this shopperReference) so they show in the top-up list.
    if (String(env.TOPUP_CARDS || '').toLowerCase() === 'off') storedPaymentMethods = [];
  } else if (scope === 'addcard') {
    paymentMethods = all.filter((m) => m.type === 'scheme');
    storedPaymentMethods = [];
  } else {
    // Pay-at-pump: cards only (pre-authorisation is a card feature), plus any saved cards.
    paymentMethods = all.filter((m) => m.type === 'scheme');
  }

  return json({ ...r.data, paymentMethods, storedPaymentMethods });
}
