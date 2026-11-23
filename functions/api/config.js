import { json, missingEnv } from '../_lib/adyen.js';

// GET /api/config -> public settings the browser needs (the client key is safe to expose).
export async function onRequestGet({ env }) {
  const missing = missingEnv(env);
  return json({
    ready: missing.length === 0,
    missing,
    environment: 'test',
    clientKey: env.ADYEN_CLIENT_KEY || null,
    merchantName: env.MERCHANT_DISPLAY_NAME || 'Petron Malaysia (demo)',
    posPinRequired: Boolean(env.POS_PIN),
  });
}
