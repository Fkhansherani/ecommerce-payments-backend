# E-Commerce & Payments Backend

Node.js + Express + MongoDB + Razorpay.

## Features
- JWT auth (user/admin), bcrypt password hashing
- Product catalog with stock tracking
- Server-side price calculation (no client trust)
- Razorpay order creation, HMAC signature verification
- Webhook handling (payment.captured / payment.failed), idempotent updates

## Setup
1. `npm install`
2. Copy `.env.example` to `.env` and fill in values (Razorpay test keys from dashboard)
3. Start MongoDB, then `npm run dev`

## API
| Method | Endpoint | Auth |
|---|---|---|
| POST | /api/auth/register | - |
| POST | /api/auth/login | - |
| GET | /api/products | - |
| POST | /api/products | admin |
| POST | /api/orders | user |
| GET | /api/orders | user |
| POST | /api/payments/verify | user |
| POST | /api/payments/webhook | Razorpay |

## Payment flow
1. `POST /api/orders` -> returns `razorpayOrderId` + `key`
2. Frontend opens Razorpay Checkout with those
3. On success, frontend calls `POST /api/payments/verify`
4. Webhook acts as backup if user closes the tab
