const functions = require('firebase-functions/v1');
const admin = require('firebase-admin');
const { MercadoPagoConfig } = require('mercadopago');
const { Expo } = require('expo-server-sdk');

// Initialize Firebase Admin
if (admin.apps.length === 0) {
    admin.initializeApp();
}

const db = admin.firestore();
const expo = new Expo();

// ── MercadoPago Configuration ────────────────────────────────────────────────
// Reads from: functions/.env (Firebase v1 auto-loads this into process.env)
// Fallback:   functions.config().mercadopago (legacy, deprecated March 2027)
const MP_ACCESS_TOKEN = process.env.MERCADOPAGO_ACCESS_TOKEN
    || functions.config().mercadopago?.access_token;
const MP_CLIENT_ID = process.env.MERCADOPAGO_CLIENT_ID
    || functions.config().mercadopago?.client_id;
const MP_CLIENT_SECRET = process.env.MERCADOPAGO_CLIENT_SECRET
    || functions.config().mercadopago?.client_secret;
const MP_WEBHOOK_SECRET = process.env.MERCADOPAGO_WEBHOOK_SECRET
    || functions.config().mercadopago?.webhook_secret;
const MP_OAUTH_REDIRECT_URI = process.env.MERCADOPAGO_OAUTH_REDIRECT_URI || null;

let mpClient;
if (MP_ACCESS_TOKEN) {
    mpClient = new MercadoPagoConfig({ accessToken: MP_ACCESS_TOKEN });
    console.log('[Config] MercadoPago configured ✅ (token: ...', MP_ACCESS_TOKEN.slice(-6), ')');
} else {
    console.warn('[Config] ⚠️ MercadoPago NOT configured - MERCADOPAGO_ACCESS_TOKEN missing from functions/.env');
}
// ─────────────────────────────────────────────────────────────────────────────

const ALLOWED_ORIGINS = [
    'https://servigo.cl',
    'https://app.servigo.cl',
    'http://localhost:5173',
    'http://localhost:3000',
];

module.exports = {
    functions,
    admin,
    db,
    expo,
    mpClient,
    // Expose individual MP credentials for OAuth handlers
    mercadopagoClientId:     { value: () => MP_CLIENT_ID },
    mercadopagoClientSecret: { value: () => MP_CLIENT_SECRET },
    mercadopagoAccessToken:  { value: () => MP_ACCESS_TOKEN },
    mercadopagoWebhookSecret:{ value: () => MP_WEBHOOK_SECRET },
    mercadopagoOAuthRedirectUri: { value: () => MP_OAUTH_REDIRECT_URI },
    cors: require('cors')({
        origin: (origin, callback) => {
            if (!origin || ALLOWED_ORIGINS.includes(origin)) {
                callback(null, true);
            } else {
                callback(new Error(`CORS: Origin '${origin}' not allowed`));
            }
        },
    }),
};
