# E-Commerce & Payments Platform

Full-stack payments app: Node.js + Express + MongoDB backend with a mobile-first frontend and Razorpay checkout.

**Live demo:** https://ecommerce-payments-backend.onrender.com

> Razorpay runs in **Test Mode** (no real money is charged). The app is hosted on a free Render instance, so the first load after inactivity can take up to ~50 seconds.

## Features

- JWT authentication with user and admin roles, bcrypt password hashing
- Product catalog with stock tracking (admin can add products)
- Cart and checkout with prices calculated on the server, never trusted from the client
- Razorpay order creation and HMAC signature verification
- Webhook handling (`payment.captured`, `payment.failed`) with idempotent updates, so duplicate events never double-count stock
- Order history per user (`created`, `paid`, `failed`)
- Mobile-first frontend served from `/public`, with light and dark themes

## Tech stack

Node.js, Express, MongoDB Atlas (Mongoose), JWT, bcryptjs, Razorpay, vanilla JS frontend, deployed on Render

## Payment flow

1. Frontend calls `POST /api/orders` with the cart. The server prices it from the database and creates a Razorpay order.
2. Razorpay Checkout opens in the browser.
3. After payment, the frontend calls `POST /api/payments/verify`. The server checks the HMAC signature, marks the order `paid` and reduces stock.
4. The webhook acts as a backup if the user closes the tab before step 3.

## API

| Method | Endpoint | Auth |
|---|---|---|
| GET | /api/health | - |
| POST | /api/auth/register | - |
| POST | /api/auth/login | - |
| GET | /api/products | - |
| POST | /api/products | admin |
| POST | /api/orders | user |
| GET | /api/orders | user |
| POST | /api/payments/verify | user |
| POST | /api/payments/webhook | Razorpay |

## Run locally

1. `npm install`
2. Copy `.env.example` to `.env` and fill in the values (MongoDB URI, JWT secret, Razorpay test keys)
3. `npm run dev`, then open http://localhost:3000

Environment variables: `MONGO_URI`, `JWT_SECRET`, `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, `PORT`

## Try the payment flow

1. Sign up in the app.
2. To add products, set your user's `role` to `admin` in the `users` collection, then log in again.
3. Add items to the cart and pay with Razorpay's test card `4111 1111 1111 1111` (any future expiry, any CVV).
4. The order appears as `paid` under Orders.

## Project structure

```
server.js        Express API, models, auth, orders, payments, webhook
public/          Frontend (index.html)
.env.example     Required environment variables
```
