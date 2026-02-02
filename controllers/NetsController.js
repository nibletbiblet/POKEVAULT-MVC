/* I will not copy or allow others to copy my code. 
 I understand that copying code is considered as plagiarism.
 
 Student Name: NGJINHENG 
 Student ID: 24024323 
 Class: C372-003-E63C
 Date created: 1/2/2026
  */
const fetch = (...args) =>
import('node-fetch').then(({ default: fetchFn }) => fetchFn(...args));
const db = require('../db');
const Order = require('../models/Order');
const Transaction = require('../models/Transaction');
const WalletModel = require('../models/WalletModel');
const netsQr = require('../services/nets');
const { applyCoinsToOrder, creditCoins } = require('../services/coinsHelper');

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

exports.startCheckout = (req, res) => {
  const cart = req.session.cart || [];
  const user = req.session.user;
  const address = (req.body.address || '').trim();
  const resumeOrderId = req.session.toPayOrderId;

  if (resumeOrderId) {
    return Order.getById(resumeOrderId, (err, existingOrder) => {
      if (err || !existingOrder) {
        console.error('Resume NETS order not found:', err);
        req.session.toPayOrderId = null;
        return res.redirect('/checkout');
      }

      req.session.netsPayment = {
        type: 'ORDER',
        orderId: resumeOrderId,
        promo: null
      };

      const coinsApplied = Number(req.session.coinsApplied || 0);
      const payable = Math.max(0, Number(existingOrder.total) - coinsApplied);
      req.session.save(() => {
        req.body.cartTotal = payable.toFixed(2);
        return netsQr.generateQrCode(req, res);
      });
    });
  }

  if (!cart.length) {
    req.flash('error', 'Your cart is empty.');
    return res.redirect('/shopping');
  }

  const promoCode = req.session.promoCode || null;
  const subtotal = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);

  const finalize = (promoApplied) => {
    const totals = computeTotals(cart, promoApplied);
    const orderData = { userId: user.id, total: totals.total, address: address || null };

    Order.create(orderData, cart, (err, result) => {
      if (err) {
        console.error('Error creating NETS order:', err);
        req.flash('error', err.message || 'Could not place order, please try again.');
        return res.redirect('/checkout');
      }

      const orderId = result.orderId;
      Order.updateStatus(orderId, 'TO_PAY', (statusErr) => {
        if (statusErr) {
          console.error('Failed to mark NETS order TO_PAY:', statusErr);
        }

        req.session.toPayOrderId = orderId;
        req.session.netsPayment = {
          type: 'ORDER',
          orderId,
          promo: promoApplied ? { code: promoApplied.code, amount: promoApplied.amount } : null
        };

        const coinsApplied = Number(req.session.coinsApplied || 0);
        const payable = Math.max(0, totals.total - coinsApplied);
        req.session.save(() => {
          req.body.cartTotal = payable.toFixed(2);
          return netsQr.generateQrCode(req, res);
        });
      });
    });
  };

  if (promoCode) {
    validatePromo(promoCode, subtotal, (err, promo) => {
      if (err) {
        console.error('Error validating promo:', err);
        req.flash('error', 'Could not validate promo code.');
        req.session.promoCode = null;
        return finalize(null);
      }
      if (!promo) {
        req.flash('error', 'Promo code is invalid or expired.');
        req.session.promoCode = null;
        return finalize(null);
      }
      req.session.promoCode = promo.code;
      req.session.promoAmount = promo.amount;
      return finalize(promo);
    });
  } else {
    finalize(null);
  }
};

exports.netsSuccess = (req, res) => {
  const payment = req.session.netsPayment;

  if (!payment) {
    return res.status(400).send('Missing NETS payment context');
  }

  if (payment.type === 'WALLET_TOPUP') {
    const userId = req.session.user.id;
    const amount = Number(payment.amount || 0);
    const bonus = Number(payment.bonus || 0);
    const total = amount + bonus;

    if (!total || total <= 0) {
      return res.status(400).send('Invalid top-up amount');
    }

    return WalletModel.ensureWallet(userId, (ensureErr) => {
      if (ensureErr) {
        console.error(ensureErr);
        return res.status(500).send('Failed to prepare wallet');
      }

      WalletModel.credit(userId, total, 'TOP_UP', 'NETS_QR', (creditErr) => {
        if (creditErr) {
          console.error(creditErr);
          return res.status(500).send('Failed to credit wallet');
        }

        const sql = `
          SELECT id
          FROM wallet_transactions
          WHERE user_id = ? AND type = 'TOP_UP'
          ORDER BY created_at DESC
          LIMIT 1
        `;

        db.query(sql, [userId], (err, rows) => {
          req.session.netsPayment = null;
          req.session.walletTopup = null;

          if (err || !rows.length) {
            return res.redirect('/wallet');
          }

          return res.redirect(`/wallet/receipt/${rows[0].id}`);
        });
      });
    });
  }

  if (payment.type !== 'ORDER') {
    return res.status(400).send('Missing NETS payment context');
  }

  const orderId = payment.orderId;
  if (!orderId) return res.status(400).send('Missing order ID');

  Order.getById(orderId, (err, order) => {
    if (err || !order) {
      return res.status(404).send('Order not found');
    }

    const totalAmount = Number(order.total);

    applyCoinsToOrder(req, req.session.user.id, orderId, totalAmount, (coinsErr, netAmount) => {
      if (coinsErr) {
        req.flash('error', coinsErr.message || 'Failed to apply coins');
        return res.redirect('/checkout');
      }

      Order.updateStatus(orderId, 'TO_SHIP', (statusErr) => {
        if (statusErr) {
          console.error(statusErr);
          return res.status(500).send('Failed to update order');
        }

        Transaction.create({
          orderId,
          method: 'NETS',
          status: 'COMPLETED',
          reference: 'NETS_QR',
          amount: netAmount
        }, () => {
          creditCoins(req.session.user.id, netAmount, () => {});
          req.session.orderPayments = req.session.orderPayments || {};
          req.session.orderPayments[orderId] = {
            method: 'NETS',
            cardName: null,
            cardLast4: null,
            promo: payment.promo || null
          };
          req.session.cart = [];
          req.session.promoCode = null;
          req.session.promoAmount = null;
          req.session.coinsApplied = 0;
          req.session.toPayOrderId = null;
          req.session.netsPayment = null;
          req.session.save(() => {
            res.render('nets/netsTxnSuccessStatus', {
              message: 'Payment Successful! Your order is being prepared.',
              orderId
            });
          });
        });
      });
    });
  });
};

exports.netsFail = (req, res) => {
  res.render('nets/netsTxnFailStatus', { message: 'Transaction Failed. Please try again.' });
};

exports.netsSseStatus = async (req, res) => {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive'
  });

  const txnRetrievalRef = req.params.txnRetrievalRef;
  let pollCount = 0;
  const maxPolls = 60;
  let frontendTimeoutStatus = 0;

  const interval = setInterval(async () => {
    pollCount++;
    try {
      const response = await fetch(
        'https://sandbox.nets.openapipaas.com/api/v1/common/payments/nets-qr/query',
        {
          method: 'POST',
          headers: {
            'api-key': process.env.API_KEY,
            'project-id': process.env.PROJECT_ID,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            txn_retrieval_ref: txnRetrievalRef,
            frontend_timeout_status: frontendTimeoutStatus
          })
        }
      );

      const payload = await response.json();
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
      const data = payload.result.data;

      if (data.response_code === '00' && data.txn_status === 1) {
        res.write(`data: ${JSON.stringify({ success: true })}\n\n`);
        clearInterval(interval);
        res.end();
      }
    } catch (err) {
      clearInterval(interval);
      res.write(`data: ${JSON.stringify({ fail: true })}\n\n`);
      res.end();
    }

    if (pollCount >= maxPolls) {
      clearInterval(interval);
      frontendTimeoutStatus = 1;
      res.write(`data: ${JSON.stringify({ fail: true })}\n\n`);
      res.end();
    }
  }, 5000);

  req.on('close', () => clearInterval(interval));
};
