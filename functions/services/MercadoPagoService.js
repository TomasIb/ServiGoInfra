const { MercadoPagoConfig, Preference, Payment } = require('mercadopago');

/**
 * INTEGRATION LAYER: Wraps external Mercado Pago API.
 * Uses individual Provider Tokens for Split Payments (Chile).
 */
class MercadoPagoService {
    /**
     * Creates a payment preference using the Provider's identity.
     * @param {string} providerAccessToken - Bound via OAuth.
     * @param {object} preferenceData - Items, back_urls, etc.
     */
    async createSplitPreference(providerAccessToken, preferenceData) {
        const providerMpClient = new MercadoPagoConfig({ accessToken: providerAccessToken });
        const preferenceClient = new Preference(providerMpClient);
        
        const response = await preferenceClient.create({ body: preferenceData });
        return {
            id: response.id,
            initPoint: response.init_point
        };
    }

    /**
     * Fetches payment details from MP.
     */
    async getPaymentDetails(paymentId, client) {
        const paymentClient = new Payment(client);
        return paymentClient.get({ id: paymentId });
    }

    /**
     * ADVANCED: Creates a payment directly via REST API.
     * Required for 100% control over Pago Retenido (capture: false).
     */
    async createPayment(providerAccessToken, paymentData) {
        const providerMpClient = new MercadoPagoConfig({ accessToken: providerAccessToken });
        const paymentClient = new Payment(providerMpClient);
        
        return paymentClient.create({ body: paymentData });
    }

    /**
     * ADVANCED: Generates a card token (for testing/automation).
     * In Production, this must happen on the React Native Client (PCI Compliance).
     */
    async createCardToken(providerAccessToken, cardData) {
        const response = await fetch('https://api.mercadopago.com/v1/card_tokens', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${providerAccessToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(cardData)
        });
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(`CARD_TOKEN_ERROR: ${error.message || 'Unknown error'}`);
        }
        
        return response.json();
    }
}

module.exports = new MercadoPagoService();
