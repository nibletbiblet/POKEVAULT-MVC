const Order = require('../models/Order');
const Product = require('../models/Product');
const db = require('../db');

const GST_RATE = 0.09;
const DELIVERY_RATE = 0.15;

const validatePromo = (code, subtotal, callback) => {
  if (!code) return callback(null, null);
  const sql = `
    SELECT id, code, discountType, discountValue, maxDiscount, minSubtotal, expiresAt, active
    FROM promo_codes
    WHERE code = ?
    LIMIT 1
  `;
  db.query(sql, [code], (err, rows) => {
    if (err) return callback(err);
    const promo = rows && rows[0] ? rows[0] : null;
    if (!promo || !promo.active) return callback(null, null);
    if (promo.expiresAt && new Date(promo.expiresAt) < new Date()) return callback(null, null);
    const minSubtotal = promo.minSubtotal != null ? Number(promo.minSubtotal) : 0;
    if (subtotal < minSubtotal) return callback(null, null);
    const value = Number(promo.discountValue);
    let discount = 0;
    if (promo.discountType === 'percent') {
      discount = subtotal * (value / 100);
    } else {
      discount = value;
    }
    if (promo.maxDiscount != null) {
      discount = Math.min(discount, Number(promo.maxDiscount));
    }
    discount = Math.min(discount, subtotal);
    return callback(null, { code: promo.code, amount: Number(discount.toFixed(2)) });
  });
};

const computeTotals = (cart, promo) => {
  const subtotal = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const promoAmount = promo ? promo.amount : 0;
  const taxableBase = Math.max(0, subtotal - promoAmount);
  const gst = Number((taxableBase * GST_RATE).toFixed(2));
  const deliveryFee = Number((taxableBase * DELIVERY_RATE).toFixed(2));
  const total = Number((taxableBase + gst + deliveryFee).toFixed(2));
  return { subtotal, promoAmount, gst, deliveryFee, total };
};

const OrderController = {
  checkoutForm(req, res) {
    const cart = req.session.cart || [];
    const user = req.session.user;
    if (!cart.length) return res.redirect('/shopping');
    const promoCode = req.session.promoCode || null;
    const subtotal = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
    const renderPage = (promoApplied) => {
      const totals = computeTotals(cart, promoApplied);
      res.render('checkout', {
        cart,
        subtotal: totals.subtotal,
        discount: totals.promoAmount,
        gst: totals.gst,
        deliveryFee: totals.deliveryFee,
        total: totals.total,
        gstRate: GST_RATE,
        deliveryRate: DELIVERY_RATE,
        user,
        messages: req.flash('error'),
        promoApplied
      });
    };

    if (promoCode) {
      validatePromo(promoCode, subtotal, (err, promo) => {
        if (err) {
          console.error('Error validating promo:', err);
          req.flash('error', 'Could not validate promo code.');
          req.session.promoCode = null;
          return renderPage(null);
        }
        if (!promo) {
          req.flash('error', 'Promo code is invalid or expired.');
          req.session.promoCode = null;
          return renderPage(null);
        }
        req.session.promoCode = promo.code;
        req.session.promoAmount = promo.amount;
        return renderPage(promo);
      });
    } else {
      renderPage(null);
    }
  },

  placeOrder(req, res) {
    const cart = req.session.cart || [];
    const user = req.session.user;
    const address = (req.body.address || '').trim();
    const paymentMethod = req.body.paymentMethod || 'card';
    const cardName = (req.body.cardName || '').trim();
    const cardNumberRaw = (req.body.cardNumber || '').replace(/\D/g, '');
    const cardLast4 = cardNumberRaw ? cardNumberRaw.slice(-4) : null;
    if (!cart.length) {
      req.flash('error', 'Your cart is empty.');
      return res.redirect('/shopping');
    }

    const promoCode = req.session.promoCode || null;
    const subtotal = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);

    const finalizeOrder = (promoApplied) => {
      const totals = computeTotals(cart, promoApplied);
      const orderData = { userId: user.id, total: totals.total, address: address || null };

      Order.create(orderData, cart, (err, result) => {
        if (err) {
          console.error('Error creating order:', err);
          req.flash('error', err.message || 'Could not place order, please try again.');
          return res.redirect('/checkout');
        }
        req.session.orderPayments = req.session.orderPayments || {};
        req.session.orderPayments[result.orderId] = {
          method: paymentMethod === 'cash' ? 'Cash on Delivery' : 'Card',
          cardName: cardName || null,
          cardLast4: paymentMethod === 'card' ? cardLast4 : null,
          promo: promoApplied ? { code: promoApplied.code, amount: promoApplied.amount } : null
        };
        req.session.cart = [];
        req.session.promoCode = null;
        req.session.promoAmount = null;
        return res.redirect(`/orders/${result.orderId}`);
      });
    };

    if (promoCode) {
      validatePromo(promoCode, subtotal, (err, promo) => {
        if (err) {
          console.error('Error validating promo during checkout:', err);
          req.flash('error', 'Could not validate promo code.');
          req.session.promoCode = null;
          return finalizeOrder(null);
        }
        if (!promo) {
          req.flash('error', 'Promo code is invalid or expired.');
          req.session.promoCode = null;
          return finalizeOrder(null);
        }
        finalizeOrder(promo);
      });
    } else {
      finalizeOrder(null);
    }
  },

  list(req, res) {
    const user = req.session.user;
    Order.getByUser(user.id, (err, orders) => {
      if (err) {
        console.error('Error fetching orders:', err);
        return res.status(500).send('Database error');
      }
      res.render('orders', { orders, user });
    });
  },

  detail(req, res) {
    const user = req.session.user;
    const orderId = req.params.id;
    Order.getWithItems(orderId, (err, data) => {
      if (err) {
        console.error('Error fetching order detail:', err);
        return res.status(500).send('Database error');
      }
      if (!data) return res.status(404).send('Order not found');
      // Ensure user owns the order (simple check)
      if (data.order.userId !== user.id && user.role !== 'admin') {
        req.flash('error', 'Access denied');
        return res.redirect('/orders');
      }
      const paymentInfo = (req.session.orderPayments && req.session.orderPayments[data.order.id]) || null;
      const promoInfo = paymentInfo && paymentInfo.promo ? paymentInfo.promo : null;
      const promoAmount = promoInfo ? Number(promoInfo.amount || 0) : 0;
      const subtotal = data.items.reduce((sum, it) => sum + Number(it.price) * Number(it.quantity), 0);
      const taxableBase = Math.max(0, subtotal - promoAmount);
      const gstRate = GST_RATE;
      const deliveryRate = DELIVERY_RATE;
      const gst = Number((taxableBase * gstRate).toFixed(2));
      const deliveryFee = Number((taxableBase * deliveryRate).toFixed(2));
      const total = Number((taxableBase + gst + deliveryFee).toFixed(2));
      res.render('orderDetail', {
        order: data.order,
        items: data.items,
        user,
        paymentInfo,
        breakdown: { subtotal, gstRate, deliveryRate, gst, deliveryFee, total, promoAmount, promoCode: promoInfo ? promoInfo.code : null }
      });
    });
  }
};

module.exports = OrderController;
