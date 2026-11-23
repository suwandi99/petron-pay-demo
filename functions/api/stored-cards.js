import { adyen, json, envError } from '../_lib/adyen.js';

// GET /api/stored-cards?shopperReference=...
// Lists the card tokens Adyen holds for this shopper (created by the "Add card" flow).
export async function onRequestGet({ request, env }) {
  const bad = envError(env);
  if (bad) return bad;

  const shopperReference = new URL(request.url).searchParams.get('shopperReference') || '';
  if (!shopperReference) return json({ cards: [] });

  const q = new URLSearchParams({
    merchantAccount: env.ADYEN_MERCHANT_ACCOUNT,
    shopperReference: shopperReference.slice(0, 64),
  });
  const r = await adyen(env, 'GET', `/storedPaymentMethods?${q.toString()}`);
  if (!r.ok) return json({ error: r.data.message || 'Could not load saved cards', details: r.data }, 502);

  const cards = (r.data.storedPaymentMethods || [])
    .filter((m) => m.type === 'scheme' || m.lastFour)
    .map((m) => ({
      id: m.id,
      brand: m.brand || m.name || 'Card',
      lastFour: m.lastFour,
      expiryMonth: m.expiryMonth,
      expiryYear: m.expiryYear,
      holderName: m.holderName,
    }));
  return json({ cards });
}
