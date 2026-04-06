const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../functions/.env') });

const MercadoPagoService = require('../functions/services/MercadoPagoService');

async function runHandshakeTest() {
    console.log('🛡️  Mercado Pago HANDSHAKE: Escrow Verification...');
    
    try {
        const token = process.env.MERCADOPAGO_ACCESS_TOKEN;
        if (!token) throw new Error('MERCADOPAGO_ACCESS_TOKEN not found in .env');

        const mockData = {
            items: [{
                title: 'ESCRÓW TEST: ServiGo Professional',
                quantity: 1,
                currency_id: 'CLP',
                unit_price: 15000,
            }],
            external_reference: `ESCROW_TEST_${Date.now()}`,
            marketplace_fee: 1500,
            binary_mode: true,
            capture: false, // THE ESCROW FLAG
            marketplace_deferred_release: true, // THE CHILE ESCROW SECRET FLAG
        };

        console.log('📡 Sending Preference to Mercado Pago with capture: false...');
        const preference = await MercadoPagoService.createSplitPreference(token, mockData);

        console.log('\n✅ HANDSHAKE SUCCESSFUL!');
        console.log(`🔗 Preference ID: ${preference.id}`);
        console.log(`🌍 Live Test URL: ${preference.initPoint}`);
        
        console.log('\n--- VERIFICATION STEPS ---');
        console.log('1. Open the Live Test URL above.');
        console.log('2. Pay with any Sandbox Card.');
        console.log('3. Runscripts/check-payments.sh');
        console.log('4. Verify: Status: approved | Cap: False');
        
    } catch (error) {
        console.error('❌ HANDSHAKE FAILED:', error.message);
    }
}

runHandshakeTest();
