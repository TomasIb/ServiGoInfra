const functions = require('firebase-functions/v1');
const admin = require('firebase-admin');
const { defineSecret, defineString } = require('firebase-functions/params');
const { MercadoPagoConfig } = require('mercadopago');
const { Expo } = require('expo-server-sdk');

// Initialize Firebase Admin
if (admin.apps.length === 0) {
    admin.initializeApp();
}

const db = admin.firestore();
const expo = new Expo();

// ── NEW FIREBASE PARAMS (deprecates functions.config()) ──
// Set via: firebase functions:secrets:set MERCADOPAGO_ACCESS_TOKEN
const mercadopagoAccessToken = defineSecret('MERCADOPAGO_ACCESS_TOKEN');
const mercadopagoClientId = defineString('MERCADOPAGO_CLIENT_ID');
const mercadopagoClientSecret = defineSecret('MERCADOPAGO_CLIENT_SECRET');

// Configure Mercado Pago
let mpClient;
try {
    const MP_ACCESS_TOKEN = mercadopagoAccessToken.value();
    if (MP_ACCESS_TOKEN) {
        mpClient = new MercadoPagoConfig({ accessToken: MP_ACCESS_TOKEN });
        console.log('[Config] MercadoPago configured ✅');
    } else {
        console.warn('[Config] MercadoPago NOT configured - missing MERCADOPAGO_ACCESS_TOKEN secret');
    }
} catch (err) {
    console.warn('[Config] Could not initialize MercadoPago (param may not be set):', err.message);
}

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
    // Firebase Params (new API)
    mercadopagoAccessToken,
    mercadopagoClientId,
    mercadopagoClientSecret,
    cors: require('cors')({
        origin: (origin, callback) => {
            // Allow server-to-server requests (no origin header) and whitelisted origins
            if (!origin || ALLOWED_ORIGINS.includes(origin)) {
                callback(null, true);
            } else {
                callback(new Error(`CORS: Origin '${origin}' not allowed`));
            }
        },
    }),
};
