require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const Razorpay = require('razorpay');

const app = express();
// Webhook ko raw body chahiye (signature verify ke liye) - express.json se PEHLE
app.use('/api/payments/webhook', express.raw({ type: 'application/json' }));
app.use(express.json());

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

/* ---------- Models ---------- */
const User = mongoose.model('User', new mongoose.Schema({
  name: String,
  email: { type: String, unique: true },
  password: String,
  role: { type: String, default: 'user' }, // 'user' | 'admin'
}));

const Product = mongoose.model('Product', new mongoose.Schema({
  name: String,
  price: Number, // rupees
  stock: Number,
}));

const Order = mongoose.model('Order', new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  items: [{ product: mongoose.Schema.Types.ObjectId, name: String, price: Number, qty: Number }],
  amount: Number, // rupees
  status: { type: String, enum: ['created', 'paid', 'failed'], default: 'created' },
  razorpayOrderId: String,
  razorpayPaymentId: String,
}, { timestamps: true }));

/* ---------- Helpers ---------- */
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const auth = (req, res, next) => {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Unauthorized' });
  }
};
const adminOnly = (req, res, next) =>
  req.user.role === 'admin' ? next() : res.status(403).json({ error: 'Admin only' });

// Payment success hone par order paid mark + stock kam (idempotent)
async function markPaid(razorpayOrderId, paymentId) {
  const order = await Order.findOneAndUpdate(
    { razorpayOrderId, status: { $ne: 'paid' } },
    { status: 'paid', razorpayPaymentId: paymentId },
    { new: true }
  );
  if (!order) return null; // pehle se paid hai
  for (const it of order.items) {
    await Product.updateOne({ _id: it.product }, { $inc: { stock: -it.qty } });
  }
  return order;
}
app.get('/', (_req, res) =>
  res.json({ status: 'ok', message: 'E-Commerce Payments API', docs: '/api/products' }));
/* ---------- Auth ---------- */
app.post('/api/auth/register', wrap(async (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password) return res.status(400).json({ error: 'Missing fields' });
  const user = await User.create({ name, email, password: await bcrypt.hash(password, 10) });
  res.status(201).json({ id: user._id, email: user.email });
}));

app.post('/api/auth/login', wrap(async (req, res) => {
  const user = await User.findOne({ email: req.body.email });
  if (!user || !(await bcrypt.compare(req.body.password || '', user.password)))
    return res.status(401).json({ error: 'Invalid credentials' });
  const token = jwt.sign({ id: user._id, role: user.role }, process.env.JWT_SECRET, { expiresIn: '7d' });
  res.json({ token });
}));

/* ---------- Products ---------- */
app.get('/api/products', wrap(async (_req, res) => res.json(await Product.find())));
app.post('/api/products', auth, adminOnly, wrap(async (req, res) =>
  res.status(201).json(await Product.create(req.body))));

/* ---------- Orders ---------- */
// Body: { items: [{ productId, qty }] } - price hamesha DB se, client pe bharosa nahi
app.post('/api/orders', auth, wrap(async (req, res) => {
  const items = [];
  let amount = 0;
  for (const { productId, qty } of req.body.items || []) {
    const p = await Product.findById(productId);
    if (!p || qty < 1 || p.stock < qty)
      return res.status(400).json({ error: `Unavailable: ${productId}` });
    items.push({ product: p._id, name: p.name, price: p.price, qty });
    amount += p.price * qty;
  }
  if (!items.length) return res.status(400).json({ error: 'Empty cart' });

  const rzpOrder = await razorpay.orders.create({
    amount: Math.round(amount * 100), // paise
    currency: 'INR',
  });
  const order = await Order.create({
    user: req.user.id, items, amount, razorpayOrderId: rzpOrder.id,
  });
  res.status(201).json({ order, razorpayOrderId: rzpOrder.id, key: process.env.RAZORPAY_KEY_ID });
}));

app.get('/api/orders', auth, wrap(async (req, res) =>
  res.json(await Order.find({ user: req.user.id }).sort('-createdAt'))));

/* ---------- Payments ---------- */
// Frontend checkout ke baad: { razorpay_order_id, razorpay_payment_id, razorpay_signature }
app.post('/api/payments/verify', auth, wrap(async (req, res) => {
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
  const expected = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
    .update(`${razorpay_order_id}|${razorpay_payment_id}`).digest('hex');
  if (expected !== razorpay_signature) return res.status(400).json({ error: 'Invalid signature' });
  await markPaid(razorpay_order_id, razorpay_payment_id);
  res.json({ status: 'paid' });
}));

// Razorpay dashboard me webhook set karo: payment.captured / payment.failed
app.post('/api/payments/webhook', wrap(async (req, res) => {
  const sig = req.headers['x-razorpay-signature'];
  const expected = crypto.createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET)
    .update(req.body).digest('hex');
  if (sig !== expected) return res.status(400).send('Invalid signature');

  const event = JSON.parse(req.body.toString());
  const pay = event.payload?.payment?.entity;
  if (event.event === 'payment.captured') await markPaid(pay.order_id, pay.id);
  if (event.event === 'payment.failed')
    await Order.updateOne({ razorpayOrderId: pay.order_id, status: 'created' }, { status: 'failed' });
  res.json({ ok: true });
}));

/* ---------- Errors + Start ---------- */
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(err.code === 11000 ? 409 : 500).json({ error: err.message });
});

mongoose.connect(process.env.MONGO_URI).then(() =>
  app.listen(process.env.PORT || 3000, () => console.log('Server running')));
