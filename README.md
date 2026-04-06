# ServiGo Infrastructure

Central Firebase infrastructure for the ServiGo platform. This repo manages all shared backend services consumed by both the mobile app (ServiGo) and web app (ServiGoWebApp).

## Structure

```
ServiGoInfra/
├── firebase.json              # Firebase CLI config
├── .firebaserc                # Project aliases
├── firestore.indexes.json     # Unified Firestore composite indexes
├── rules/
│   ├── firestore.rules        # Firestore security rules (production)
│   ├── firestore.rules.maintenance  # Open rules for seeding/debug
│   └── storage.rules          # Storage security rules
├── functions/                 # Cloud Functions (Node.js 22)
│   ├── index.js               # Entry point - exports all functions
│   ├── config.js              # Firebase Admin, MercadoPago, Expo init
│   ├── handlers/              # Function handlers
│   │   ├── payments.js        # MercadoPago escrow, webhooks, refunds
│   │   ├── bookings.js        # Booking status lifecycle
│   │   ├── services.js        # Service moderation, dedup
│   │   ├── reviews.js         # Rating recalculation
│   │   ├── notifications.js   # Push notifications via Expo
│   │   └── coupons.js         # Coupon validation
│   ├── services/              # Business logic layer
│   │   ├── PaymentService.js
│   │   ├── MercadoPagoService.js
│   │   ├── BookingService.js
│   │   ├── ReviewService.js
│   │   ├── CouponService.js
│   │   └── PointsService.js
│   ├── repositories/
│   │   └── BookingRepository.js
│   └── scripts/               # Maintenance scripts
│       ├── cleanApp.js
│       └── fix_all_ratings.js
└── scripts/                   # DB management & ops scripts
    ├── seed-firestore.mjs     # Seed Firestore with demo data (web)
    ├── seed-coupons.js        # Seed test coupons
    ├── automated-escrow-hold.js
    ├── test-escrow-flow.js
    ├── test-handshake.js
    ├── debug-escrow-hold.js
    ├── check-payments.py
    ├── check-payments.sh
    └── setup-firebase.sh      # Firebase project setup wizard
```

## Firebase Project

- **Project ID:** `pruebaapp-11b43`
- **Region:** `us-central1`

## Deploy

```bash
# Deploy everything
firebase deploy

# Deploy only functions
firebase deploy --only functions

# Deploy only rules
firebase deploy --only firestore:rules,storage

# Deploy only indexes
firebase deploy --only firestore:indexes
```

## Cloud Functions

| Function | Trigger | Description |
|----------|---------|-------------|
| `createPreference` | HTTPS | Create MercadoPago payment preference |
| `webhookMercadoPago` | HTTPS | MercadoPago webhook handler |
| `verifyPayment` | HTTPS | Verify payment status |
| `createEscrowPayment` | HTTPS | Create escrow payment (capture: false) |
| `releaseBookingFunds` | HTTPS | Release held funds after completion |
| `initiateRefund` | HTTPS | Process refund |
| `resolveDispute` | HTTPS | Resolve payment dispute |
| `autoApproveCompletedBookings` | Scheduled | Auto-release funds after timeout |
| `handleBookingStatusChange` | Firestore | Booking status lifecycle triggers |
| `updateBookingStatus` | HTTPS | Manual status update |
| `preventDuplicateServices` | Firestore | Prevent duplicate service creation |
| `cleanupDuplicateServices` | HTTPS | Clean existing duplicates |
| `handleServiceModeration` | Firestore | Auto-moderation on service create |
| `handleReviewCreated` | Firestore | Recalculate provider ratings |
| `recalculateAllRatings` | HTTPS | Batch recalculate all ratings |
| `notifyOnNewNotification` | Firestore | Send push via Expo |
| `validateCoupon` | HTTPS | Validate coupon codes |

## Scripts

```bash
# Seed Firestore with demo data (services, providers, clients, bookings)
node scripts/seed-firestore.mjs

# Seed test coupons
node scripts/seed-coupons.js

# Test escrow payment flow
node scripts/test-escrow-flow.js

# Setup Firebase project from scratch
bash scripts/setup-firebase.sh
```

## Clients

- **Mobile App:** [ServiGo](../ServiGo) (React Native / Expo)
- **Web App:** [ServiGoWebApp](../ServiGoWebApp) (React / Vite)
