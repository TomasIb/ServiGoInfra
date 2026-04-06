/**
 * AUTOMATED ESCROW AUDITOR: Real Payment Hold (No Simulation)
 * Proves the 'capture: false' protocol on the Payments API.
 */

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../functions/.env') });

const MercadoPagoService = require('../functions/services/MercadoPagoService');
const PaymentService = require('../functions/services/PaymentService');

async function testRealEscrowHold() {
    console.log('\n🛡️  STARTING REAL ESCROW AUDIT (capture: false)...');
    
    try {
        const token = process.env.MERCADOPAGO_ACCESS_TOKEN;
        if (!token) throw new Error('MERCADOPAGO_ACCESS_TOKEN not found');

        // 1. TOKENIZE (Bypassing Frontend UI)
        console.log('📡 Tokenizing Sandbox Card (Chile Master)...');
        const cardData = {
            card_number: '5254133674403564',
            expiration_month: 11,
            expiration_year: 2030,
            security_code: '123',
            cardholder: { name: 'APRO' }
        };

        const tokenData = await MercadoPagoService.createCardToken(token, cardData);
        console.log(`✅ Token Created: ${tokenData.id}`);

        // 2. CREATE ESCROW PAYMENT (The REAL Hold)
        const mockProvider = { id: 'PROV_123', mpAccessToken: token };
        const paymentData = {
            paymentMethodId: 'master',
            token: tokenData.id,
            email: 'test_client@servigo.cl'
        };

        console.log('📡 Sending Real Payment with capture: false...');
        const payment = await PaymentService.createEscrowPayment(
            'ESCRÓW_AUDIT_' + Date.now(), 
            15000, 
            mockProvider, 
            paymentData
        );

        // 3. FINAL AUDIT
        console.log('\n--- 🔬 AUDIT RESULTS ---');
        console.log(`Payment ID: ${payment.id}`);
        console.log(`Status: ${payment.status}`);
        console.log(`Captured: ${payment.captured}`);

        if (payment.captured === false && (payment.status === 'approved' || payment.status === 'authorized')) {
            console.log('\n🏆 TEST SUCCESSFUL: REAL ESCROW HOLD ACHIEVED.');
            console.log('FUNDS ARE NOW HELD UNTIL THE RELEASE COMMAND.');
        } else {
            console.warn('\n❌ WARNING: Payment was captured immediately or failed.');
            console.log(`Debug Info: ${JSON.stringify(payment)}`);
        }
        
    } catch (error) {
        console.error('\n🐞 AUDIT FAILED:', error.message);
    }
}

testRealEscrowHold();
