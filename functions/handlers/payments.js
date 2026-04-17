const { functions, db, mpClient, cors, admin, expo, mercadopagoClientId, mercadopagoClientSecret, mercadopagoOAuthRedirectUri } = require('../config');
const { MercadoPagoConfig, Preference, Payment } = require('mercadopago');
const { Expo } = require('expo-server-sdk');
const crypto = require('crypto');

// LAYERED ARCHITECTURE IMPORTS (ADR-001)
const PaymentService = require('../services/PaymentService');

/**
 * CAPA 1 - FUNCIÓN 1: Crear Preferencia de Pago (Checkout Pro - MP Marketplace Split con OAuth)
 *
 * Usa el access_token OAuth del proveedor para crear la preferencia. Así:
 *   - El pago se registra en la cuenta MP del proveedor (vía OAuth-link).
 *   - ServiGo actúa como marketplace y cobra `marketplace_fee` (10%).
 *   - `marketplace_deferred_release: true` retiene los fondos hasta que ServiGo
 *     los libere explícitamente (PUT money_release_date con el token del proveedor).
 *
 * Precondición: el proveedor DEBE haber vinculado su cuenta MP vía OAuth.
 * Si no, se lanza `failed-precondition / PROVIDER_NOT_LINKED_MP_OAUTH` y el
 * frontend muestra un mensaje claro + bloquea el botón de pagar.
 */
exports.createPreference = functions.runWith({ maxInstances: 1, memory: '256MB', timeoutSeconds: 30 }).https.onCall(async (data, context) => {
    functions.logger.info(`[Payment] createPreference (OAuth Split) triggered`, { auth: !!context.auth, uid: context.auth?.uid });

    if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'SESSION_NOT_RECOGNIZED_BY_SERVER');

    const { bookingId, serviceId, webAppUrl } = data;

    if (!bookingId) {
        throw new functions.https.HttpsError('invalid-argument', 'Falta parámetro: bookingId es requerido.');
    }

    try {
        // 0. Read authoritative data from Firestore — never trust the client
        const bookingDoc = await db.collection('bookings').doc(bookingId).get();
        if (!bookingDoc.exists) throw new functions.https.HttpsError('not-found', 'Reserva no encontrada');
        const bookingData = bookingDoc.data();

        // Verify the caller is the client of this booking
        if (bookingData.clientId !== context.auth.uid) {
            throw new functions.https.HttpsError('permission-denied', 'No tienes permiso para pagar esta reserva.');
        }

        const amount = bookingData.totalPrice;
        if (!amount || amount <= 0) {
            throw new functions.https.HttpsError('failed-precondition', 'El monto de la reserva no es válido.');
        }

        // 1. Load provider and verify MP OAuth link
        const providerId = bookingData.providerId;
        if (!providerId) {
            throw new functions.https.HttpsError('failed-precondition', 'La reserva no tiene proveedor asignado.');
        }
        const providerDoc = await db.collection('users').doc(providerId).get();
        if (!providerDoc.exists) {
            throw new functions.https.HttpsError('not-found', 'Proveedor no encontrado.');
        }
        const providerData = providerDoc.data();
        const providerAccessToken = providerData.mpAccessToken;
        const providerCollectorId = providerData.mpCollectorId;

        if (!providerAccessToken || !providerCollectorId) {
            functions.logger.warn(`[Payment] Provider ${providerId} has not linked MP OAuth — cannot create preference for booking=${bookingId}`);
            throw new functions.https.HttpsError(
                'failed-precondition',
                'PROVIDER_NOT_LINKED_MP_OAUTH: Este proveedor aún no ha vinculado su cuenta de MercadoPago. Contáctalo o elige otro proveedor.'
            );
        }

        // 2. Resolve serviceId from booking if not provided
        const resolvedServiceId = serviceId || bookingData.serviceId;
        if (!resolvedServiceId) {
            throw new functions.https.HttpsError('failed-precondition', 'No se encontró el servicio asociado a esta reserva.');
        }

        const serviceDoc = await db.collection('services').doc(resolvedServiceId).get();
        if (!serviceDoc.exists) throw new functions.https.HttpsError('not-found', 'Servicio no encontrado');
        const serviceData = serviceDoc.data();

        // 3. Calculate marketplace fee (10%)
        const marketplaceFee = Math.round(Number(amount) * 0.10);

        // 4. Build back_urls — prefer server-side WEB_APP_URL (trusted) over client-sent value
        let baseUrl = process.env.WEB_APP_URL;

        // Fallback: Firebase config
        if (!baseUrl) {
            try {
                baseUrl = functions.config().app?.web_url || '';
            } catch (e) {
                functions.logger.warn(`[Payment] Could not read app.web_url from config: ${e.message}`);
            }
        }

        // Last resort: client-provided URL (only if it's a valid public URL)
        if (!baseUrl && webAppUrl && webAppUrl.startsWith('https://') && !webAppUrl.includes('localhost')) {
            baseUrl = webAppUrl;
        }

        functions.logger.info(`[Payment] Resolved baseUrl: "${baseUrl}"`);

        if (!baseUrl || !baseUrl.startsWith('https://')) {
            functions.logger.error(`[Payment] WEB_APP_URL not configured or invalid: "${baseUrl}".`);
            throw new functions.https.HttpsError(
                'failed-precondition',
                'SERVER_CONFIG_ERROR: La URL del servidor no está configurada correctamente. Contacta soporte.'
            );
        }

        const backUrls = {
            success: `${baseUrl}/client/bookings/${bookingId}?payment=success`,
            failure: `${baseUrl}/client/bookings/${bookingId}?payment=failure`,
            pending: `${baseUrl}/client/bookings/${bookingId}?payment=pending`,
        };

        functions.logger.info(`[Payment] Back URLs constructed: success=${backUrls.success}`);

        // 5. Build notification_url (explicit webhook pointing at ServiGo's webhookMP)
        const projectId = admin.app().options.projectId || process.env.GCLOUD_PROJECT;
        const notificationUrl = `https://us-central1-${projectId}.cloudfunctions.net/webhookMercadoPago`;

        // 6. Create MP client with the PROVIDER'S OAuth access token (not the marketplace token)
        const providerMpClient = new MercadoPagoConfig({ accessToken: providerAccessToken });
        const preferenceClient = new Preference(providerMpClient);

        const preferenceResponse = await preferenceClient.create({
            body: {
                items: [{
                    id: resolvedServiceId,
                    title: serviceData.title || bookingData.serviceTitle || 'Servicio Profesional',
                    quantity: 1,
                    currency_id: 'CLP',
                    unit_price: Number(amount),
                }],
                back_urls: backUrls,
                auto_return: 'approved',
                external_reference: bookingId,
                marketplace_fee: marketplaceFee,
                binary_mode: true,
                marketplace_deferred_release: true,
                notification_url: notificationUrl,
                metadata: { bookingId, providerId },
            }
        });

        functions.logger.info(`[Payment] Preference created via provider OAuth: preferenceId=${preferenceResponse.id}, providerId=${providerId}, collectorId=${providerCollectorId}`);

        // 7. Update booking with preference info + providerCollectorId for later lookups
        await db.collection('bookings').doc(bookingId).update({
            paymentPreferenceId: preferenceResponse.id,
            paymentStatus: 'pending',
            collectorType: 'split_marketplace_deferred',
            providerMpCollectorId: providerCollectorId,
            servigoFee: marketplaceFee,
            providerPayout: Number(amount) - marketplaceFee,
            retenidoStatus: 'none',
        });

        return { success: true, initPoint: preferenceResponse.init_point, preferenceId: preferenceResponse.id };
    } catch (error) {
        // Preserve HttpsError codes so the frontend can distinguish PROVIDER_NOT_LINKED_MP_OAUTH
        if (error instanceof functions.https.HttpsError) {
            functions.logger.warn(`[Payment] createPreference HttpsError: ${error.code} — ${error.message}`);
            throw error;
        }
        functions.logger.error(`[Payment] createPreference unexpected error: ${error.message}`, error);
        throw new functions.https.HttpsError('internal', error.message);
    }
});


/**
 * CAPA 1 - FUNCIÓN 2: Procesar Pago Directo (Checkout API - Bricks)
 * SOPORTA ESCROW AUTOMÁTICO (capture: false)
 */
exports.processPayment = functions.runWith({ maxInstances: 1, memory: '256MB', timeoutSeconds: 60 }).https.onCall(async (data, context) => {
    functions.logger.info(`[Payment] processPayment (Checkout API) triggered`, { uid: context.auth?.uid });

    if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Acceso denegado');

    const { bookingId, token, payment_method_id, installments, issuer_id, email } = data;
    // NOTE: 'amount' from client is intentionally ignored — we read from Firestore.

    if (!bookingId || !token || !payment_method_id) {
        throw new functions.https.HttpsError('invalid-argument', 'Faltan parámetros requeridos.');
    }

    try {
        const bookingRef = db.collection('bookings').doc(bookingId);
        const bookingDoc = await bookingRef.get();
        if (!bookingDoc.exists) throw new Error('Reserva no encontrada');

        const bookingData = bookingDoc.data();

        // Verify caller is the booking's client
        if (bookingData.clientId !== context.auth.uid) {
            throw new functions.https.HttpsError('permission-denied', 'No tienes permiso para pagar esta reserva.');
        }

        // Authoritative amount from Firestore
        const amount = bookingData.totalPrice;
        if (!amount || amount <= 0) throw new Error('Monto de reserva inválido');

        const providerId = bookingData.providerId;
        const providerDoc = await db.collection('users').doc(providerId).get();
        const providerMpId = providerDoc.exists ? (providerDoc.data().mpCollectorId || providerDoc.data().mercadoPagoUserId) : null;

        const marketPlaceFee = Math.round(Number(amount) * 0.10);

        // MODO ESCROW AUTOMÁTICO
        // capture: false -> El dinero se autoriza pero no se mueve.
        const paymentData = {
            transaction_amount: Number(amount),
            token: token,
            description: `ServiGo: ${bookingDoc.data().serviceTitle}`,
            installments: Number(installments) || 1,
            payment_method_id: payment_method_id,
            issuer_id: issuer_id,
            payer: {
                email: email || context.auth.token.email,
            },
            capture: false, // <--- CLAVE: RESERVA DE FONDOS
            external_reference: bookingId,
            // NOTE: binary_mode is intentionally NOT set here.
            // binary_mode: true is INCOMPATIBLE with capture: false (pre-authorization).
            // capture: false produces status 'authorized', binary_mode forces only 'approved'/'rejected'.
            // SPLIT condicional: solo si el proveedor tiene cuenta MP vinculada
            ...(providerMpId ? {
                marketplace_fee: marketPlaceFee,
                collector_id: Number(providerMpId),
            } : {}),
        };

        functions.logger.info(`[Payment] Creating escrow payment for booking=${bookingId}, amount=${amount}, hasSplit=${!!providerMpId}`);

        const paymentClient = new Payment(mpClient);
        const response = await paymentClient.create({ body: paymentData });

        functions.logger.info(`[Payment] MP response: status=${response.status}, id=${response.id}, detail=${response.status_detail}`);

        if (response.status === 'authorized' || response.status === 'approved') {
            await bookingRef.update({
                paymentId: response.id,
                paymentStatus: response.status === 'authorized' ? 'held' : 'approved',
                status: 'payment_held',
                paid: true,
                retenidoStatus: response.status === 'authorized' ? 'held' : 'released',
                collectorType: providerMpId ? 'split_payment' : 'marketplace_escrow',
                servigoFee: marketPlaceFee,
                providerPayout: Number(amount) - marketPlaceFee,
                paidAt: admin.firestore.FieldValue.serverTimestamp()
            });

            return { success: true, status: response.status, paymentId: response.id };
        } else {
            functions.logger.warn(`[Payment] Payment not authorized: status=${response.status}, detail=${response.status_detail}`);
            return { success: false, status: response.status, detail: response.status_detail };
        }
    } catch (error) {
        functions.logger.error(`[Payment] Error processPayment`, error);
        throw new functions.https.HttpsError('internal', error.message);
    }
});

/**
 * CAPA 1 - FUNCIÓN 2: Webhook de Mercado Pago
 */
exports.webhookMercadoPago = functions.runWith({ maxInstances: 1, memory: '128MB', timeoutSeconds: 30 }).https.onRequest(async (req, res) => {
    return cors(req, res, async () => {
        // ── WEBHOOK SIGNATURE VERIFICATION ──────────────────────────────────────
        // MercadoPago signs webhooks with HMAC-SHA256. Reject unsigned or tampered
        // notifications to prevent fake payment confirmations.
        const webhookSecret = process.env.MERCADOPAGO_WEBHOOK_SECRET || functions.config().mercadopago?.webhook_secret;
        if (webhookSecret) {
            const xSignature = req.headers['x-signature'];
            const xRequestId = req.headers['x-request-id'];
            const dataId = req.query['data.id'] || req.body?.data?.id;

            if (!xSignature) {
                console.warn('[Webhook] Missing x-signature header — rejecting request');
                return res.status(403).send('Forbidden: missing signature');
            }

            // Parse signature parts: ts=...;v1=...
            const parts = {};
            xSignature.split(';').forEach(part => {
                const [k, v] = part.split('=');
                if (k && v) parts[k.trim()] = v.trim();
            });

            const manifest = `id:${dataId};request-id:${xRequestId};ts:${parts.ts};`;
            const expected = crypto
                .createHmac('sha256', webhookSecret)
                .update(manifest)
                .digest('hex');

            if (expected !== parts.v1) {
                console.warn('[Webhook] Signature mismatch — rejecting tampered notification');
                return res.status(403).send('Forbidden: invalid signature');
            }
        } else {
            console.warn('[Webhook] MERCADOPAGO_WEBHOOK_SECRET not configured — skipping signature check');
        }
        // ────────────────────────────────────────────────────────────────────────

        const { type, data } = req.body;
        if (type !== 'payment') return res.status(200).send('OK');

        const paymentId = data.id;
        try {
            // 1. Get initial booking to find out whose provider token we need
            // In MP Marketplace, the notification comes to the Collector's Webhook
            // BUT we must use the Collector's Token to query the payment details.

            // First attempt with marketplace client
            let paymentData;
            try {
                const paymentClient = new Payment(mpClient);
                paymentData = await paymentClient.get({ id: paymentId });
            } catch (e) {
                console.log(`[Webhook] Payment not found with main client, searching by external_reference...`);
                // If not found, it might belong to a provider's linked account
                // We don't have the external_reference yet in the body "data", only "id".
                // This is a known MP Marketplace challenge. 
                // Workaround: We must trust that if it's not in our main account, 
                // it might be a marketplace payment. 
                throw e; // We will handle this by improving search in createPreference or using a master marketplace token
            }

            const bookingId = paymentData.external_reference;
            const bookingRef = db.collection('bookings').doc(bookingId);
            const bookingDoc = await bookingRef.get();
            if (!bookingDoc.exists) return res.status(404).send('Booking not found');

            // ── CENTRALIZED STATUS SYNC (ADR-001) ──
            const syncResult = await PaymentService.updatePaymentStatusSync(bookingId, paymentData);
            
            console.log(`[Webhook Sync] Result: BookingID=${bookingId}, Status=${syncResult.status}`);

            // Send notifications if status indicating success
            if (syncResult.paid) {
                await sendPaymentNotifications(bookingId, bookingDoc.data(), 'approved');
            } else if (syncResult.status === 'payment_failed') {
                await sendPaymentNotifications(bookingId, bookingDoc.data(), 'rejected');
            }

            return res.status(200).send('OK');
        } catch (error) {
            console.error(`[Webhook] Error processing notification: PaymentID=${paymentId}`, error);
            return res.status(500).send('Error');
        }
    });
});

/**
 * CAPA 1 - FUNCIÓN 3: Verificar Pago Manualmente
 */
exports.verifyPayment = functions.runWith({ maxInstances: 1, memory: '128MB', timeoutSeconds: 30 }).https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'No autenticado.');
    }

    const { bookingId } = data;
    if (!bookingId) throw new functions.https.HttpsError('invalid-argument', 'Falta bookingId.');

    try {
        const bookingRef = db.collection('bookings').doc(bookingId);
        const bookingDoc = await bookingRef.get();
        if (!bookingDoc.exists) throw new Error('Reserva no encontrada.');

        const bookingDataRaw = bookingDoc.data();

        // Always use marketplace mpClient — all payments go through marketplace account
        const paymentClient = new Payment(mpClient);
        const searchResponse = await paymentClient.search({
            qs: {
                external_reference: bookingId,
                sort: 'date_created',
                criteria: 'desc'
            }
        });

        if (searchResponse.results && searchResponse.results.length > 0) {
            const payment = searchResponse.results[0];

            // ── CENTRALIZED STATUS SYNC (ADR-001) ──
            const syncResult = await PaymentService.updatePaymentStatusSync(bookingId, payment);
            
            console.log(`[Verify Sync] Result: BookingID=${bookingId}, Status=${syncResult.status}`);

            return {
                found: true,
                status: syncResult.paymentStatus,
                appStatus: syncResult.status,
                paymentId: syncResult.paymentId,
                amount: syncResult.transactionAmount,
                paid: syncResult.paid
            };
        }
        return { found: false };
    } catch (error) {
        console.error(`[Verification] Error: BookingID=${bookingId}`, error);
        throw new functions.https.HttpsError('internal', error.message);
    }
});

async function sendPaymentNotifications(bookingId, bookingData, status) {
    try {
        const [clientDoc, serviceDoc] = await Promise.all([
            db.collection('users').doc(bookingData.clientId).get(),
            db.collection('services').doc(bookingData.serviceId).get()
        ]);

        const serviceTitle = serviceDoc.data()?.title || 'Servicio';
        const clientName = clientDoc.data()?.name || 'Un cliente';

        if (status === 'approved') {
            const batch = db.batch();
            const notificationsRef = db.collection('notifications');

            // 1. Notificación visual para el Cliente
            batch.set(notificationsRef.doc(), {
                userId: bookingData.clientId,
                title: '✅ Pago Confirmado',
                body: `Tu reserva de "${serviceTitle}" ha sido pagada y asegurada.`,
                read: false,
                type: 'payment_approved',
                bookingId: bookingId,
                icon: 'card-outline',
                color: '#10B981',
                createdAt: admin.firestore.FieldValue.serverTimestamp()
            });

            // 2. Notificación visual para el Proveedor
            batch.set(notificationsRef.doc(), {
                userId: bookingData.providerId,
                title: '💰 Nueva Reserva Pagada',
                body: `${clientName} ha pagado exitosamente por "${serviceTitle}".`,
                read: false,
                type: 'new_booking',
                bookingId: bookingId,
                icon: 'cash-outline',
                color: '#059669',
                createdAt: admin.firestore.FieldValue.serverTimestamp()
            });

            await batch.commit();
            console.log(`[Payment] Notificaciones enrutadas a la Campanita para BookingID=${bookingId}`);
        }
    } catch (error) {
        console.error('❌ Error sendPaymentNotifications:', error);
    }
}

/**
 * CAPA 1 - FUNCIÓN 4: OAUTH CALLBACK MERCADO PAGO
 * Vincula oficialmente la cuenta del vendedor para hacer splits legales
 */
exports.oauthMercadoPago = functions.runWith({ maxInstances: 1, memory: '128MB', timeoutSeconds: 30 }).https.onRequest(async (req, res) => {
    return cors(req, res, async () => {
        const code = req.query.code;
        const nonce = req.query.state; // ONLY nonce (no pipe format)

        if (!code || !nonce) {
            return res.status(400).send('Código de autorización o estado (state) faltante.');
        }

        // ── NONCE VERIFICATION ───────────────────────────────────────────────────
        // The nonce was created by `initiateMpOAuth` and stored in Firestore with
        // the provider's UID, webRedirectBase, and expiry timestamp. This prevents
        // attackers from injecting an arbitrary UID into the state parameter.
        const nonceRef = db.collection('oauth_states').doc(nonce);
        const nonceDoc = await nonceRef.get();

        if (!nonceDoc.exists) {
            console.warn(`[OAuth Security] Nonce not found: ${nonce}`);
            return res.status(403).send('Estado de OAuth inválido o expirado.');
        }

        const nonceData = nonceDoc.data();
        const now = admin.firestore.Timestamp.now();

        if (nonceData.expiresAt.toMillis() < now.toMillis()) {
            await nonceRef.delete();
            console.warn(`[OAuth Security] Nonce expired for provider: ${nonceData.providerId}`);
            return res.status(403).send('Estado de OAuth expirado. Inicia el proceso nuevamente.');
        }

        const providerId = nonceData.providerId;
        let webRedirectBase = nonceData.webRedirectBase || null;
        // Consume the nonce (one-time use)
        await nonceRef.delete();
        // ────────────────────────────────────────────────────────────────────────

        // PREVENCIÓN OPEN REDIRECT: Validar webRedirectBase
        if (webRedirectBase) {
            const allowedOrigins = [
                'http://localhost:5173',
                'https://servigo.cl',
                'https://app.servigo.cl'
            ];
            if (!allowedOrigins.includes(webRedirectBase)) {
                console.warn(`[OAuth Security] Bloqueado intento de Open Redirect hacia: ${webRedirectBase}`);
                webRedirectBase = null; // Fallback al deeplink mobile o url por defecto
            }
        }

        try {
            const projectId = admin.app().options.projectId || process.env.GCLOUD_PROJECT;
            const redirectUri = mercadopagoOAuthRedirectUri.value()
                || `https://us-central1-${projectId}.cloudfunctions.net/oauthMercadoPago`;

            // Validate required OAuth credentials (using new params API)
            let clientId, clientSecret;
            try {
                clientId = mercadopagoClientId.value();
                clientSecret = mercadopagoClientSecret.value();
            } catch (err) {
                console.error('[OAuth] Missing Firebase params:', err.message);
                return res.status(500).send('Error de configuración: credenciales de OAuth no disponibles.');
            }

            if (!clientId || !clientSecret) {
                console.error('[OAuth] MERCADOPAGO_CLIENT_ID or MERCADOPAGO_CLIENT_SECRET not set');
                return res.status(500).send('Error de configuración: credenciales de OAuth incompletas.');
            }

            const data = {
                client_id: clientId,
                client_secret: clientSecret,
                grant_type: 'authorization_code',
                code: code,
                redirect_uri: redirectUri
            };

            console.log(`[OAuth] Exchanging code for token. clientId=...${String(clientId).slice(-4)}, redirectUri=${redirectUri}`);

            const response = await fetch('https://api.mercadopago.com/oauth/token', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });

            const result = await response.json();

            if (!response.ok) {
                console.error(`[OAuth] Token exchange failed: HTTP ${response.status}`, JSON.stringify(result));
            }

            if (result.access_token) {
                console.log(`[OAuth] Vinculación exitosa para ProviderID=${providerId}, MP_Collector=${result.user_id}`);

                await db.collection('users').doc(providerId).update({
                    mpAccessToken: result.access_token,
                    mpRefreshToken: result.refresh_token,
                    mpPublicKey: result.public_key,
                    mpCollectorId: String(result.user_id),
                    mpLinkedAt: admin.firestore.FieldValue.serverTimestamp()
                });

                // Redirect back: web URL if provided, mobile deep link otherwise
                if (webRedirectBase) {
                    res.redirect(`${webRedirectBase}/provider/profile?mp_linked=true`);
                } else {
                    res.redirect(`servigo://settings/payment?success=true`);
                }
            } else {
                console.error(`[OAuth] Error en intercambio de tokens para ProviderID=${providerId}`, result);
                if (webRedirectBase) {
                    res.redirect(`${webRedirectBase}/provider/profile?mp_linked=false&error=exchange_failed`);
                } else {
                    res.redirect(`servigo://settings/payment?success=false&error=exchange_failed`);
                }
            }
        } catch (error) {
            console.error(`[OAuth] Error crítico en servidor para ProviderID=${providerId}`, error);
            if (webRedirectBase) {
                res.redirect(`${webRedirectBase}/provider/profile?mp_linked=false&error=server_error`);
            } else {
                res.redirect(`servigo://settings/payment?success=false&error=server_error`);
            }
        }
    });
});
/**
 * CAPA 4 - LIBERACIÓN DE FONDOS SINCRONIZADA CON MERCADO PAGO
 * Se activa cuando 'fundsReleased: true' (cliente aprueba el servicio)
 * 
 * SINCRONIZACIÓN REAL CON MP:
 * Llama a PUT /v1/payments/{id} con money_release_date = HOY
 * para liberar los fondos del proveedor anticipadamente (antes de los 14 días).
 */
exports.releaseBookingFunds = functions.runWith({ maxInstances: 1, memory: '256MB', timeoutSeconds: 60 }).firestore
    .document('bookings/{bookingId}')
    .onUpdate(async (change, context) => {
        const after = change.after.data();
        const before = change.before.data();

        // Detectar disparador: fundsReleased cambia a true
        if (after.fundsReleased === true && before.fundsReleased !== true) {
            const bookingId = context.params.bookingId;
            const paymentId = after.paymentId;
            
            console.log(`[Payout] 🚀 Liberación de fondos iniciada. Booking=${bookingId}, Payment=${paymentId}`);

            try {
                // IMPORTANT: Use totalPrice to align with frontend and PaymentService
                const totalAmount = Number(after.totalPrice || after.price || 0);
                const fee = Number(after.servigoFee || Math.round(totalAmount * 0.10));
                const providerAmount = totalAmount - fee;

                let mpReleaseStatus = 'not_attempted';

                // ── SINCRONIZACIÓN CON MERCADO PAGO ──
                if (paymentId) {
                    // Load provider OAuth token — payments live on the provider's account
                    // because createPreference was called with their access_token.
                    let providerAccessToken = null;
                    if (after.providerId) {
                        try {
                            const providerDoc = await db.collection('users').doc(after.providerId).get();
                            providerAccessToken = providerDoc.exists ? providerDoc.data().mpAccessToken : null;
                        } catch (e) {
                            console.warn(`[Escrow] No se pudo leer provider token: ${e.message}`);
                        }
                    }
                    const marketplaceToken = process.env.MERCADOPAGO_ACCESS_TOKEN;
                    const releaseToken = providerAccessToken || marketplaceToken;

                    // CASE A: Payment is 'authorized' (Held via capture:false — legacy Checkout API)
                    // We need to CAPTURE it to actually transfer money.
                    if (after.paymentStatus === 'authorized' || after.escrowStatus === 'held' || after.captured === false) {
                        try {
                            const { Payment } = require('mercadopago');
                            // Use provider's client if available (payment is on their account)
                            const clientForCapture = providerAccessToken
                                ? new MercadoPagoConfig({ accessToken: providerAccessToken })
                                : mpClient;
                            const paymentClient = new Payment(clientForCapture);
                            console.log(`[Escrow] 🎯 Capturar fondos pre-autorizados (capture: true) para Booking=${bookingId}`);

                            const captureResult = await paymentClient.capture({ id: paymentId });

                            if (captureResult.status === 'approved') {
                                console.log(`[Escrow] ✅ MP CAPTURED: El dinero ha sido transferido. Billing=${bookingId}`);
                                mpReleaseStatus = 'released';
                            } else {
                                throw new Error(`Falló la captura del pago: ${captureResult.status}`);
                            }
                        } catch (captureError) {
                            console.error(`[Escrow] ❌ Error al capturar fondos:`, captureError.message);
                            mpReleaseStatus = 'mp_capture_error';
                        }
                    }
                    // CASE B: Payment approved with marketplace_deferred_release.
                    // Release funds early by setting money_release_date = today.
                    // Uses the provider's OAuth token because the payment is on their account
                    // (sponsor-linked to the ServiGo marketplace).
                    else if (releaseToken) {
                        try {
                            const today = new Date().toISOString();
                            const tokenSource = providerAccessToken ? 'provider_oauth' : 'marketplace_fallback';

                            console.log(`[Escrow] 🔔 Liberando fondos mediante PUT money_release_date para Booking=${bookingId} (token=${tokenSource})`);

                            const releaseResponse = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
                                method: 'PUT',
                                headers: {
                                    'Authorization': `Bearer ${releaseToken}`,
                                    'Content-Type': 'application/json'
                                },
                                body: JSON.stringify({ money_release_date: today })
                            });

                            const releaseResult = await releaseResponse.json();

                            if (releaseResponse.ok) {
                                console.log(`[Escrow] ✅ MP SINCRONIZADO: Fondos liberados anticipadamente.`);
                                mpReleaseStatus = 'released';
                            } else {
                                console.warn(`[Escrow] ⚠️ Error en PUT release:`, releaseResult.message);
                                mpReleaseStatus = 'mp_default_schedule';
                            }
                        } catch (mpError) {
                            console.warn(`[Escrow] ⚠️ Error de red en liberación MP:`, mpError.message);
                            mpReleaseStatus = 'mp_sync_error';
                        }
                    } else {
                        console.warn(`[Escrow] ⚠️ No hay token marketplace para liberación.`);
                        mpReleaseStatus = 'no_marketplace_token';
                    }
                }

                // ── ACTUALIZAR FIRESTORE ──
                const releaseMessage = mpReleaseStatus === 'released'
                    ? `💰 Fondos liberados en Mercado Pago. $${providerAmount} disponible para el proveedor.`
                    : `💰 Servicio aprobado. $${providerAmount} se liberará al proveedor según calendario de MP.`;

                await change.after.ref.update({
                    payoutStatus: 'completed',
                    payoutAmount: providerAmount,
                    mpReleaseStatus: mpReleaseStatus,
                    payoutAt: admin.firestore.FieldValue.serverTimestamp(),
                    statusHistory: admin.firestore.FieldValue.arrayUnion({
                        status: 'payout_completed',
                        message: releaseMessage,
                        timestamp: admin.firestore.Timestamp.now(),
                        userRole: 'system',
                        uid: 'split_payment_engine'
                    })
                });

                // ── NOTIFICACIÓN PUSH ──
                if (after.providerId) {
                    const providerDoc = await db.collection('users').doc(after.providerId).get();
                    const pushToken = providerDoc.data()?.expoPushToken;
                    if (pushToken && Expo.isExpoPushToken(pushToken)) {
                        const pushBody = mpReleaseStatus === 'released'
                            ? `¡El cliente aprobó tu trabajo! $${providerAmount} ya están disponibles en tu cuenta.`
                            : `¡El cliente aprobó tu trabajo! $${providerAmount} estarán disponibles pronto en tu cuenta.`;
                        
                        await expo.sendPushNotificationsAsync([{
                            to: pushToken,
                            title: '💰 Pago Liberado',
                            body: pushBody,
                            data: { bookingId, type: 'payout' }
                        }]);
                    }
                }

                console.log(`[Payout] ✅ Proceso completado para Booking=${bookingId}. MP_Status=${mpReleaseStatus}`);

            } catch (error) {
                console.error(`[Payout] ❌ ERROR:`, error);
                await change.after.ref.update({ 
                    payoutStatus: 'error', 
                    payoutError: error.message,
                    statusHistory: admin.firestore.FieldValue.arrayUnion({
                        status: 'payout_error',
                        message: `❌ Error al procesar liberación: ${error.message}`,
                        timestamp: admin.firestore.Timestamp.now(),
                        userRole: 'system'
                    })
                });
            }
        }
        return null;
    });

/**
 * CAPA 5 - REGISTRO DE DISPUTA (Modelo Fiverr)
 * 
 * El cliente reporta un problema → Se registra en Firestore como 'disputed'.
 * NO ejecuta reembolso automático. El Admin revisa y decide desde el panel.
 */
exports.initiateRefund = functions.runWith({ maxInstances: 1, memory: '256MB', timeoutSeconds: 60 }).https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Acceso denegado');

    const { bookingId, reason } = data;
    const uid = context.auth.uid;

    functions.logger.info(`[Dispute] Disputa registrada por UID=${uid} para Booking=${bookingId}`);

    try {
        const bookingRef = db.collection('bookings').doc(bookingId);
        const bookingDoc = await bookingRef.get();
        if (!bookingDoc.exists) throw new Error('Reserva no encontrada');
        const booking = bookingDoc.data();

        if (booking.clientId !== uid) {
            throw new functions.https.HttpsError('permission-denied', 'Solo el cliente puede abrir una disputa.');
        }

        const validStatuses = ['completed_pending_release', 'payment_held', 'confirmed', 'in_progress'];
        if (!validStatuses.includes(booking.status)) {
            throw new functions.https.HttpsError('failed-precondition', `No se puede disputar en estado: ${booking.status}`);
        }

        // Registrar disputa (SIN reembolso automático)
        await bookingRef.update({
            status: 'disputed',
            disputeReason: reason || 'Cliente reportó un problema',
            disputeAt: admin.firestore.FieldValue.serverTimestamp(),
            disputeStatus: 'pending_review',
            payoutStatus: 'on_hold',
            statusHistory: admin.firestore.FieldValue.arrayUnion({
                status: 'disputed',
                message: `⚠️ Disputa abierta: ${reason || 'Problema reportado'}. Pendiente de revisión del administrador.`,
                timestamp: admin.firestore.Timestamp.now(),
                userRole: 'client',
                uid: uid
            })
        });

        // Notificar al proveedor
        const providerDoc = await db.collection('users').doc(booking.providerId).get();
        const pushToken = providerDoc.data()?.expoPushToken;
        if (pushToken && Expo.isExpoPushToken(pushToken)) {
            await expo.sendPushNotificationsAsync([{
                to: pushToken,
                title: '⚠️ Disputa Abierta',
                body: 'Un cliente ha reportado un problema. El administrador revisará el caso.',
                data: { bookingId, type: 'dispute' }
            }]);
        }

        return { success: true, message: 'Disputa registrada. El administrador revisará tu caso.' };
    } catch (error) {
        functions.logger.error(`[Dispute] Error:`, error);
        throw new functions.https.HttpsError('internal', error.message);
    }
});

/**
 * CAPA 5B - RESOLUCIÓN DE DISPUTA (Solo Admin)
 * 
 * El Admin revisa la disputa y decide:
 * - 'approve_refund' → Reembolsa al cliente via API de MP
 * - 'reject_refund'  → Libera fondos al proveedor
 */
exports.resolveDispute = functions.runWith({ maxInstances: 1, memory: '256MB', timeoutSeconds: 60 }).https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Acceso denegado');

    const { bookingId, resolution, adminNote } = data;
    const uid = context.auth.uid;

    const adminDoc = await db.collection('users').doc(uid).get();
    const adminData = adminDoc.data();
    if (adminData?.role !== 'admin' && adminData?.role !== 'superadmin') {
        throw new functions.https.HttpsError('permission-denied', 'Solo el administrador puede resolver disputas.');
    }

    functions.logger.info(`[Dispute] Resolución: ${resolution} por Admin=${uid}, Booking=${bookingId}`);

    try {
        const bookingRef = db.collection('bookings').doc(bookingId);
        const bookingDoc = await bookingRef.get();
        if (!bookingDoc.exists) throw new Error('Reserva no encontrada');
        const booking = bookingDoc.data();

        if (booking.status !== 'disputed') {
            throw new functions.https.HttpsError('failed-precondition', 'No está en estado de disputa.');
        }

        if (resolution === 'approve_refund') {
            let refundSuccess = false;
            let refundId = null;

            if (booking.paymentId) {
                const marketplaceToken = process.env.MERCADOPAGO_ACCESS_TOKEN;
                if (marketplaceToken) {
                    try {
                        const resp = await fetch(`https://api.mercadopago.com/v1/payments/${booking.paymentId}/refunds`, {
                            method: 'POST',
                            headers: { 'Authorization': `Bearer ${marketplaceToken}`, 'Content-Type': 'application/json' },
                            body: JSON.stringify({})
                        });
                        const result = await resp.json();
                        if (resp.ok) { refundSuccess = true; refundId = result.id; }
                        else { console.error(`[Dispute] MP refund error:`, result); }
                    } catch (e) { console.error(`[Dispute] MP error:`, e.message); }
                }
            }

            await bookingRef.update({
                status: 'cancelled',
                disputeStatus: 'refund_approved',
                disputeResolvedAt: admin.firestore.FieldValue.serverTimestamp(),
                disputeResolvedBy: uid,
                disputeAdminNote: adminNote || '',
                refundId, refundStatus: refundSuccess ? 'approved' : 'manual_required',
                payoutStatus: 'refunded',
                statusHistory: admin.firestore.FieldValue.arrayUnion({
                    status: 'dispute_resolved',
                    message: `✅ Reembolso ${refundSuccess ? 'procesado' : 'pendiente'}. ${adminNote || ''}`,
                    timestamp: admin.firestore.Timestamp.now(),
                    userRole: 'admin', uid
                })
            });

            const clientDoc = await db.collection('users').doc(booking.clientId).get();
            const clientPush = clientDoc.data()?.expoPushToken;
            if (clientPush && Expo.isExpoPushToken(clientPush)) {
                await expo.sendPushNotificationsAsync([{ to: clientPush, title: '✅ Disputa Resuelta', body: 'Tu reembolso ha sido aprobado.', data: { bookingId, type: 'dispute_resolved' } }]);
            }
            return { success: true, refundProcessed: refundSuccess, refundId };

        } else if (resolution === 'reject_refund') {
            await bookingRef.update({
                status: 'completed',
                disputeStatus: 'refund_rejected',
                disputeResolvedAt: admin.firestore.FieldValue.serverTimestamp(),
                disputeResolvedBy: uid,
                disputeAdminNote: adminNote || '',
                fundsReleased: true,
                fundsReleasedAt: admin.firestore.FieldValue.serverTimestamp(),
                statusHistory: admin.firestore.FieldValue.arrayUnion({
                    status: 'dispute_resolved',
                    message: `❌ Disputa rechazada: Fondos liberados al proveedor. ${adminNote || ''}`,
                    timestamp: admin.firestore.Timestamp.now(),
                    userRole: 'admin', uid
                })
            });

            const providerDoc2 = await db.collection('users').doc(booking.providerId).get();
            const pt = providerDoc2.data()?.expoPushToken;
            if (pt && Expo.isExpoPushToken(pt)) {
                await expo.sendPushNotificationsAsync([{ to: pt, title: '✅ Disputa Resuelta', body: 'Tu pago ha sido liberado.', data: { bookingId, type: 'dispute_resolved' } }]);
            }
            return { success: true, resolution: 'funds_released' };
        } else {
            throw new functions.https.HttpsError('invalid-argument', 'Resolución inválida.');
        }
    } catch (error) {
        functions.logger.error(`[Dispute] Error:`, error);
        throw new functions.https.HttpsError('internal', error.message);
    }
});

/**
 * CAPA 6 - AUTO-APROBACIÓN (Modelo Fiverr)
 * 
 * Se ejecuta cada 6 horas. Busca bookings en 'completed_pending_release'
 * con más de 7 días sin respuesta del cliente → auto-aprueba y libera fondos.
 */
exports.autoApproveCompletedBookings = functions.runWith({ memory: '256MB', timeoutSeconds: 120 })
    .pubsub.schedule('every 1 hours').onRun(async () => {
        functions.logger.info(`[AutoApprove] Checking bookings for category-based auto-release...`);

        try {
            // Load category-based release windows from config
            const escrowDoc = await db.collection('configurations').doc('escrow').get();
            const escrowConfig = escrowDoc.exists ? escrowDoc.data() : {};
            const releaseWindows = escrowConfig.releaseWindows || {};
            const defaultWindowHours = escrowConfig.defaultWindow || 72;

            const snapshot = await db.collection('bookings')
                .where('status', '==', 'completed_pending_release')
                .where('fundsReleased', '!=', true)
                .get();

            let autoApprovedCount = 0;

            for (const doc of snapshot.docs) {
                const booking = doc.data();

                // Determine the release window for this booking's category
                const category = booking.serviceCat || booking.serviceCategory || '';
                const windowHours = releaseWindows[category] || defaultWindowHours;
                const windowMs = windowHours * 3600000;

                // Find the timestamp when the booking entered completed_pending_release
                const enteredAt = booking.workerCompletedAt?.toDate?.()
                    || booking.statusHistory?.slice(-1)[0]?.timestamp?.toDate?.()
                    || booking.updatedAt?.toDate?.()
                    || booking.paymentCreatedAt?.toDate?.();

                if (!enteredAt) continue;

                const elapsed = Date.now() - enteredAt.getTime();
                if (elapsed < windowMs) continue;

                const elapsedHours = Math.round(elapsed / 3600000);
                functions.logger.info(`[AutoApprove] Auto-releasing Booking=${doc.id} (${elapsedHours}h elapsed, window=${windowHours}h, category=${category})`);

                await doc.ref.update({
                    status: 'completed',
                    fundsReleased: true,
                    fundsReleasedAt: admin.firestore.FieldValue.serverTimestamp(),
                    autoApproved: true,
                    autoApproveWindowHours: windowHours,
                    completedAt: admin.firestore.FieldValue.serverTimestamp(),
                    statusHistory: admin.firestore.FieldValue.arrayUnion({
                        status: 'auto_approved',
                        message: `Servicio auto-aprobado (${windowHours}h sin respuesta del cliente). Fondos liberados.`,
                        timestamp: admin.firestore.Timestamp.now(),
                        userRole: 'system',
                        uid: 'auto_approve_engine'
                    })
                });

                // Notificar al proveedor
                if (booking.providerId) {
                    const providerDoc = await db.collection('users').doc(booking.providerId).get();
                    const pushToken = providerDoc.data()?.expoPushToken;
                    if (pushToken && Expo.isExpoPushToken(pushToken)) {
                        await expo.sendPushNotificationsAsync([{
                            to: pushToken,
                            title: 'Servicio Auto-Aprobado',
                            body: `Tu servicio fue aprobado automáticamente. El pago está en camino.`,
                            data: { bookingId: doc.id, type: 'auto_approve' }
                        }]);
                    }
                }

                // Notificar al cliente
                if (booking.clientId) {
                    await db.collection('notifications').add({
                        userId: booking.clientId,
                        title: 'Servicio confirmado automáticamente',
                        body: `Tu reserva de "${booking.serviceTitle}" fue confirmada automáticamente. El pago fue liberado al proveedor.`,
                        read: false,
                        type: 'auto_approve',
                        bookingId: doc.id,
                        createdAt: admin.firestore.FieldValue.serverTimestamp()
                    });
                }

                autoApprovedCount++;
            }

            functions.logger.info(`[AutoApprove] Done. ${autoApprovedCount} bookings auto-released.`);
            return null;
        } catch (error) {
            functions.logger.error(`[AutoApprove] Error:`, error);
            return null;
        }
    });
