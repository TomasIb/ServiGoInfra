# ServiGo Infrastructure — Firebase Backend

> Centralized Firebase infrastructure for the ServiGo platform.
> Manages Cloud Functions, Firestore/Storage rules, composite indexes, and operational scripts.

## Stack

| Component         | Technology                                            |
| ----------------- | ----------------------------------------------------- |
| Functions Runtime | Node.js 22                                            |
| SDKs              | `firebase-admin`, `firebase-functions`, `mercadopago`, `expo-server-sdk` |
| Database          | Cloud Firestore (Rules + Composite Indexes)           |
| Storage           | Firebase Storage (Rules)                              |
| Region            | `us-central1`                                         |

## Build & Deploy Commands

| Action | Command |
| --- | --- |
| Deploy all | `firebase deploy` |
| Deploy functions | `firebase deploy --only functions` |
| Deploy Firestore rules | `firebase deploy --only firestore:rules` |
| Deploy Firestore indexes | `firebase deploy --only firestore:indexes` |
| Deploy Storage rules | `firebase deploy --only storage:rules` |

## Cloud Functions

| Function | Type | Description |
| --- | --- | --- |
| `createPreference` | HTTPS | [Mercado Pago] Create checkout preference |
| `webhookMP` | HTTPS | [Mercado Pago] Webhook listener for IPNs |
| `releaseFunds` | HTTPS | [Pago Retenido] Capture held funds |
| `autoRelease` | Cron | [Pago Retenido] Auto-release after timeout |
| `onBookingChange` | DB | [Lifecycle] Notifications & state transitions |

## Mercado Pago & Fee Structure

- **Marketplace fee**: 10%
- **Gateway fee (MP)**: 3.8%
- **Net to provider**: 86.2%
- All calculations should use CLP (Chilean Peso) integers.

## Firestore Data Model

- `users`: Profile and roles (`client`/`provider`/`admin`).
- `services`: Marketplace listings.
- `bookings`: Transaction registry and payment status.
- `reviews`: Peer reviews for completed services.
- `chats`: Messaging for bookings.
- `notifications`: In-app alerts.

## Configuration

Required environment variables (Firebase Functions):
- `mercadopago.access_token`: Access token from MP Dashboard.
- Set via: `firebase functions:config:set mercadopago.access_token="YOUR_TOKEN"`

## AI Agent Instructions

- **Infra First**: Any change relating to backend logic or database security MUST happen here.
- **Security Check**: Never relax Firestore rules without documented reasoning. NEVER disable PRODUCTION RULES.
- **TDD for Logic**: When modifying `functions/services/`, add or update tests.
- **Synchronicity**: Keep `firestore.indexes.json` synced with app query patterns.
- **Workflow**: Test locally using Firebase Emulators: `npm run serve` (in `/functions`).
