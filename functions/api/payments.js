import { adyen, json, envError, checkAmount, CURRENCY } from '../_lib/adyen.js';

// Only these fields from the Adyen Web `state.data` are forwarded to /payments.
const ALLOWED_DATA_KEYS = [
  'paymentMethod',
  'browserInfo',
  'billingAddress',
  'origin',
  'riskData',
  'clientStateDataIndicator',
  'storePaymentMethod',
  'shopperName',
  'shopperEmail',
  'telephoneNumber',
];

// POST /api/payments { data, kind: 'topup' | 'preauth' | 'addcard', amount, shopperReference }
//   topup   - one-off payment with a non-card method (DuitNow QR, FPX, e-wallets)
//   preauth - card payment authorised but NOT captured (manual capture) -> fuel hold
//   addcard - zero-value card authorisation that stores the card (tokenisation)
export async function onRequestPost({ request, env }) {
  const bad = envError(env);
  if (bad) return bad;

  const { data = {}, kind, amount, shopperReference } = await request.json();
  if (!['topup', 'preauth', 'addcard'].includes(kind)) return json({ error: 'Unknown payment kind' }, 400);
  const value = checkAmount(amount, kind);
  if (value === null) return json({ error: 'Amount is outside the allowed range for this demo' }, 400);

  const shopperRef = String(shopperReference || '').slice(0, 64);
  const origin = new URL(request.url).origin;
  const forwarded = {};
  for (const k of ALLOWED_DATA_KEYS) if (data[k] !== undefined) forwarded[k] = data[k];

  const isCard = forwarded.paymentMethod?.type === 'scheme' || Boolean(forwarded.paymentMethod?.storedPaymentMethodId);

  const body = {
    ...forwarded,
    merchantAccount: env.ADYEN_MERCHANT_ACCOUNT,
    amount: { currency: CURRENCY, value },
    reference: `${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    returnUrl: `${origin}/`,
    channel: 'Web',
    countryCode: 'MY',
    shopperLocale: 'en-US',
    shopperInteraction: 'Ecommerce',
  };
  if (shopperRef) body.shopperReference = shopperRef;

  if (isCard) {
    body.authenticationData = { threeDSRequestData: { nativeThreeDS: 'preferred' } };
    // Only mark the payment as card-on-file when a token is used or created; a one-off card payment is not.
    if (shopperRef && (forwarded.paymentMethod?.storedPaymentMethodId || forwarded.storePaymentMethod)) {
      body.recurringProcessingModel = 'CardOnFile';
    }
  }
  if (kind === 'preauth') {
    // Pre-authorisation: reserve funds, capture later (partial / adjusted) from the Station POS.
    body.additionalData = { authorisationType: 'PreAuth', manualCapture: 'true' };
  }
  if (kind === 'addcard') {
    body.storePaymentMethod = true;
    body.recurringProcessingModel = 'CardOnFile';
  }

  const r = await adyen(env, 'POST', '/payments', body);
  if (!r.ok) return json({ error: r.data.message || 'Payment request failed', details: r.data }, 502);

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
