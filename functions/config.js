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

// Configure Mercado Pago (using .env file instead of deprecated functions.config())
const MP_ACCESS_TOKEN = process.env.MERCADOPAGO_ACCESS_TOKEN || functions.config().mercadopago?.access_token;
let mpClient;

if (MP_ACCESS_TOKEN) {
    mpClient = new MercadoPagoConfig({ accessToken: MP_ACCESS_TOKEN });
    console.log('[Config] MercadoPago configured ✅');
} else {
    console.warn('[Config] MercadoPago NOT configured - missing MERCADOPAGO_ACCESS_TOKEN');
}

module.exports = {
    functions,
    admin,
    db,
    expo,
    mpClient,
    cors: require('cors')({ origin: true })
};
