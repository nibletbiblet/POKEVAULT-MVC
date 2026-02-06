/* I will not copy or allow others to copy my code. 
 I understand that copying code is considered as plagiarism.
 
 Student Name: NGJINHENG 
 Student ID: 24024323 
 Class: C372-003-E63C
 Date created: 1/2/2026
  */
const db = require('../db');
const Order = require('../models/Order');
const Transaction = require('../models/Transaction');
const WalletModel = require('../models/WalletModel');
const BnplModel = require('../models/BnplModel');
const BnplRefundModel = require('../models/BnplRefundModel');
const BnplCardModel = require('../models/BnplCardModel');
const paypal = require('../services/paypal');
const crypto = require('crypto');
const mailer = require('../services/mailer');
const {
  BNPL_SANDBOX_CARD_NUMBER,
  BNPL_SANDBOX_CARD_EXPIRY
} = require('../config/constants');
const { applyCoinsToOrder, creditCoins } = require('../services/coinsHelper');
const { logAdminActivity } = require('../services/adminActivity');

const sha256 = (plain) => crypto.createHash('sha256').update(plain).digest('hex');
const OTP_TTL_MINUTES = Number(process.env.OTP_TTL_MINUTES || 10);
const OTP_RESEND_SECONDS = Number(process.env.OTP_RESEND_SECONDS || 60);
const OTP_MAX_ATTEMPTS = Number(process.env.OTP_MAX_ATTEMPTS || 5);
const generateOtp = () => String(Math.floor(100000 + Math.random() * 900000));

const maskEmail = (email) => {
  if (!email || typeof email !== 'string') return '';
  const [user, domain] = email.split('@');
  if (!domain) return email;
  const maskedUser = user.length <= 2
    ? `${user[0] || ''}*`
    : `${user[0]}${'*'.repeat(Math.max(1, user.length - 2))}${user[user.length - 1]}`;
  return `${maskedUser}@${domain}`;
};

function finalizeBnplCheckout(req, res, planMonths, paypalCaptureId, onComplete) {
  const orderId = req.session.toPayOrderId;

  if (!orderId) {
    req.flash('error', 'No order to pay.');
    return res.redirect('/cart');
  }

  Order.getById(orderId, (err, order) => {
    if (err || !order) return res.status(404).send('Order not found');

    const totalAmount = Number(order.total);

    applyCoinsToOrder(req, req.session.user.id, orderId, totalAmount, (err2, netAmount) => {
      if (err2) {
        req.flash('error', err2.message || 'Failed to apply coins');
        return res.redirect('/checkout');
      }

      const bnplReference = `BNPL_SANDBOX_${Date.now()}`;
      const referenceSuffix = paypalCaptureId
        ? `${planMonths}M_PAYPAL_${paypalCaptureId}`
        : `${planMonths}M`;

      Order.updateStatus(orderId, 'TO_SHIP', err3 => {
        if (err3) {
          console.error(err3);
          return res.status(500).send('Failed to update order');
        }

        Transaction.create({
          orderId,
          method: 'BNPL',
          status: 'APPROVED',
          reference: `${bnplReference}_${referenceSuffix}`,
          amount: netAmount
        }, () => {
          BnplModel.createInstallments(orderId, netAmount, planMonths, err4 => {
            if (err4) {
              console.error('BNPL installment creation failed:', err4);
            }
            const paidNow = Math.round((netAmount / Math.max(planMonths, 1)) * 100) / 100;
            creditCoins(req.session.user.id, paidNow, () => {
              req.session.orderPayments = req.session.orderPayments || {};
              req.session.orderPayments[orderId] = {
                method: 'BNPL',
                promo: req.session.promoCode ? { code: req.session.promoCode, amount: req.session.promoAmount || 0 } : null
              };
              req.session.lastOrderId = orderId;
              req.session.toPayOrderId = null;
              req.session.coinsApplied = 0;
              req.session.promoCode = null;
              req.session.promoAmount = null;
              req.session.save(() => onComplete());
            });
          });
        });
      });
    });
  });
}
exports._finalizeBnplCheckout = finalizeBnplCheckout;

exports.bnplCheckout = (req, res) => {
  const planMonths = Number(req.body.planMonths || 3);
  const userId = req.session.user.id;
  BnplCardModel.getByUserId(userId, (err, bnplCard) => {
    if (err) {
      console.error(err);
      req.flash('error', 'Failed to load BNPL card.');
      return res.redirect('/checkout');
    }
    if (!bnplCard) {
      return res.redirect(`/bnpl/card?plan=${planMonths}`);
    }
    finalizeBnplCheckout(req, res, planMonths, null, () => res.redirect('/invoice/session'));
  });
};

exports.bnplPaypalCreate = async (req, res) => {
  try {
    const { amount } = req.body;
    const order = await paypal.createOrder(amount);
    res.json({ id: order.id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
};

exports.bnplPaypalCapture = async (req, res) => {
  try {
    const { orderID, planMonths } = req.body;
    if (!orderID) return res.status(400).json({ error: 'Missing PayPal orderID' });

    const capture = await paypal.captureOrder(orderID);
    if (!capture || capture.status !== 'COMPLETED') {
      return res.status(400).json({ error: 'Payment not completed' });
    }

    const months = Number(planMonths || 6);
    finalizeBnplCheckout(req, res, months, capture.id, () => res.json({ success: true }));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
};

exports.cardInfoPage = (req, res) => {
  const user = req.session.user;
  const orderId = req.session.toPayOrderId;
  if (!orderId) return res.redirect('/cart');

  const planMonths = [6, 12].includes(Number(req.query.plan))
    ? Number(req.query.plan)
    : 6;

  Order.getWithItems(orderId, (err, data) => {
    if (err || !data) return res.status(500).send('Failed to load order');

    const checkoutItems = data.items.map(item => ({
      id: item.productId,
      productName: item.productName,
      image: item.image,
      quantity: item.quantity,
      price: Number(item.price)
    }));

    const grandTotal = checkoutItems.reduce(
      (sum, item) => sum + (item.price * item.quantity),
      0
    );

    BnplCardModel.getByUserId(user.id, (err2, bnplCard) => {
      if (err2) {
        console.error(err2);
        return res.status(500).send('Failed to load BNPL card');
      }

      res.render('bnpl/cardInfo', {
        cart: checkoutItems,
        user,
        planMonths,
        grandTotal,
        bnplCard,
        messages: req.flash('error'),
        success: req.flash('success'),
        emailMasked: maskEmail(user.email),
        resendSeconds: OTP_RESEND_SECONDS
      });
    });
  });
};

exports.bnplOtpRequest = async (req, res) => {
  const user = req.session.user;
  if (!user || !user.email) {
    return res.status(400).json({ ok: false, message: 'Missing user email.' });
  }

  const now = Date.now();
  const pending = req.session.bnplOtp;
  if (pending && now - Number(pending.otpLastSentAt || 0) < OTP_RESEND_SECONDS * 1000) {
    const wait = Math.ceil((OTP_RESEND_SECONDS * 1000 - (now - pending.otpLastSentAt)) / 1000);
    return res.status(429).json({ ok: false, message: `Please wait ${wait} seconds before resending.` });
  }

  const otpCode = generateOtp();
  req.session.bnplOtp = {
    otpHash: sha256(otpCode),
    otpAttempts: 0,
    otpLastSentAt: now,
    otpExpiresAt: now + OTP_TTL_MINUTES * 60 * 1000
  };

  try {
    await mailer.sendMail({
      to: user.email,
      subject: 'PokeVault BNPL OTP Verification',
      text: `Your BNPL OTP is ${otpCode}. It expires in ${OTP_TTL_MINUTES} minutes.`,
      html: `<p>Your BNPL OTP is <strong>${otpCode}</strong>.</p><p>It expires in ${OTP_TTL_MINUTES} minutes.</p>`
    });
    return res.json({ ok: true, message: 'OTP sent.' });
  } catch (mailErr) {
    console.error('BNPL OTP email failed:', mailErr);
    req.session.bnplOtp = null;
    return res.status(500).json({ ok: false, message: 'Failed to send OTP email.' });
  }
};

exports.cardSetup = (req, res) => {
  const userId = req.session.user.id;
  const { cardNumber, cardCvv, cardName, cardExpiry, billingAddress, otp, bankProvider } = req.body;
  const planMonths = Number(req.body.planMonths || 6);

  if (!cardNumber || !cardCvv || !cardName || !cardExpiry || !billingAddress || !bankProvider) {
    req.flash('error', 'Please complete your card and billing details.');
    return res.redirect('/bnpl/card');
  }

  const normalizedCardNumber = String(cardNumber).replace(/\s+/g, '');
  if (normalizedCardNumber !== BNPL_SANDBOX_CARD_NUMBER || String(cardExpiry).trim() !== BNPL_SANDBOX_CARD_EXPIRY) {
    req.flash('error', 'Card number or expiry does not match the sandbox card.');
    return res.redirect('/bnpl/card');
  }

  const cvvTrimmed = String(cardCvv).trim();
  if (!/^\d{3}$/.test(cvvTrimmed)) {
    req.flash('error', 'CVV must be exactly 3 digits.');
    return res.redirect('/bnpl/card');
  }

  const pending = req.session.bnplOtp;
  const submittedOtp = String(otp || '').trim();
  if (!pending) {
    req.flash('error', 'Please request an OTP first.');
    return res.redirect('/bnpl/card');
  }
  if (!submittedOtp) {
    req.flash('error', 'Please enter the OTP.');
    return res.redirect('/bnpl/card');
  }
  if (Date.now() > Number(pending.otpExpiresAt || 0)) {
    req.session.bnplOtp = null;
    req.flash('error', 'OTP expired. Please request a new OTP.');
    return res.redirect('/bnpl/card');
  }
  if (Number(pending.otpAttempts || 0) >= OTP_MAX_ATTEMPTS) {
    req.session.bnplOtp = null;
    req.flash('error', 'Too many attempts. Please request a new OTP.');
    return res.redirect('/bnpl/card');
  }
  const isValid = sha256(submittedOtp) === pending.otpHash;
  if (!isValid) {
    pending.otpAttempts = Number(pending.otpAttempts || 0) + 1;
    req.session.bnplOtp = pending;
    req.flash('error', 'Invalid OTP. Please try again.');
    return res.redirect('/bnpl/card');
  }

  const last4 = normalizedCardNumber.slice(-4);

  BnplCardModel.upsertCard(
    userId,
    cardName,
    last4,
    cardExpiry,
    billingAddress,
    (err) => {
      if (err) {
        console.error(err);
        req.flash('error', 'Failed to save card setup.');
        return res.redirect('/bnpl/card');
      }

      req.flash('success', 'BNPL card setup successful.');
      req.session.bnplOtp = null;
      req.session.bnplPlanMonths = planMonths;
      return res.redirect(`/checkout?bnpl=1&plan=${planMonths}`);
    }
  );
};

exports.cardValidate = (req, res) => {
  const { cardNumber, cardExpiry } = req.body;
  if (!cardNumber || !cardExpiry) {
    return res.status(400).json({ ok: false, message: 'Missing card details' });
  }

  const normalizedCardNumber = String(cardNumber).replace(/\s+/g, '');
  const expiry = String(cardExpiry).trim();

  if (normalizedCardNumber !== BNPL_SANDBOX_CARD_NUMBER || expiry !== BNPL_SANDBOX_CARD_EXPIRY) {
    return res.json({ ok: false, message: 'Card and expiry date does not match the sandbox.' });
  }

  return res.json({ ok: true });
};

exports.cardCancel = (req, res) => {
  const userId = req.session.user.id;
  BnplCardModel.deleteByUserId(userId, (err) => {
    if (err) {
      console.error(err);
      req.flash('error', 'Failed to cancel BNPL setup.');
    } else {
      req.flash('success', 'BNPL card setup cancelled.');
    }
    req.session.bnplPlanMonths = null;
    req.session.bnplOtp = null;
    res.redirect('/checkout');
  });
};

exports.schedulePage = (req, res) => {
  const orderId = req.params.id;
  const userId = req.session.user.id;

  Order.getById(orderId, (err, order) => {
    if (err || !order || order.userId !== userId) {
      return res.status(404).send('Order not found');
    }

    BnplModel.getInstallmentsByOrder(orderId, (err2, installments) => {
      if (err2) return res.status(500).send('Failed to load installments');
      res.render('bnpl/schedule', { orderId, installments });
    });
  });
};

exports.refundPage = (req, res) => {
  const orderId = req.params.id;
  const userId = req.session.user.id;

  Order.getById(orderId, (err, order) => {
    if (err || !order || order.userId !== userId) {
      return res.status(404).send('Order not found');
    }

    const sql = `
      SELECT paymentMethod
      FROM transactions
      WHERE orderId = ?
      ORDER BY id DESC
      LIMIT 1
    `;
    db.query(sql, [orderId], (err2, rows) => {
      if (err2 || !rows.length || rows[0].paymentMethod !== 'BNPL') {
        return res.status(400).send('Not a BNPL order');
      }

      BnplRefundModel.getByOrder(orderId, (err3, data) => {
        res.render('bnpl/refundRequest', {
          orderId,
          existing: data && data[0]
        });
      });
    });
  });
};

exports.refundSubmit = (req, res) => {
  const orderId = req.params.id;
  const userId = req.session.user.id;
  const reason = req.body.reason;

  if (!reason) {
    req.flash('error', 'Refund reason is required');
    return res.redirect(`/bnpl/orders/${orderId}/refund`);
  }

  BnplRefundModel.createRequest(orderId, userId, reason, err => {
    if (err) {
      req.flash('error', 'Refund request already exists');
    } else {
      req.flash('success', 'Refund request submitted');
    }
    res.redirect('/orders');
  });
};

exports.adminRefundBnpl = (req, res) => {
  const orderId = req.params.id;

  Order.getById(orderId, (err, order) => {
    if (err || !order) return res.status(404).send('Order not found');

    const sql = `
      SELECT *
      FROM transactions
      WHERE orderId = ? AND paymentMethod = 'BNPL'
      ORDER BY id DESC
      LIMIT 1
    `;

    db.query(sql, [orderId], (err2, rows) => {
      if (err2 || !rows.length) return res.status(400).send('BNPL transaction not found');

      const refundAmount = Number(order.total);
      const userId = order.userId;

      WalletModel.credit(userId, refundAmount, 'BNPL_REFUND', `ORDER_${orderId}`, err3 => {
        if (err3) {
          console.error(err3);
          return res.status(500).send('Failed to refund wallet');
        }

        Order.updateStatus(orderId, 'REFUNDED', err4 => {
          if (err4) {
            console.error(err4);
            return res.status(500).send('Failed to update order status');
          }

          Transaction.create({
            orderId,
            method: 'BNPL',
            status: 'REFUNDED',
            reference: `BNPL_REFUND_${orderId}`,
            amount: refundAmount
          }, () => {
            logAdminActivity(req, 'BNPL_REFUND', 'order', orderId, { amount: refundAmount });
            res.redirect('/admin/bnpl/refunds');
          });
        });
      });
    });
  });
};

exports.adminRefundRequestsPage = (req, res) => {
  BnplRefundModel.getAll((err, requests) => {
    if (err) return res.status(500).send('Failed to load refund requests');
    res.render('admin/bnplRefunds', { requests });
  });
};

exports.adminApproveRefundRequest = (req, res) => {
  const requestId = req.params.id;

  BnplRefundModel.updateStatus(requestId, 'APPROVED', err => {
    if (err) {
      console.error(err);
      return res.status(500).send('Failed to approve refund request');
    }
    logAdminActivity(req, 'BNPL_REFUND_APPROVE', 'bnpl_refund', requestId, {});
    res.redirect('/admin/bnpl/refunds');
  });
};

exports.adminRejectRefundRequest = (req, res) => {
  const requestId = req.params.id;

  BnplRefundModel.updateStatus(requestId, 'REJECTED', err => {
    if (err) {
      console.error(err);
      return res.status(500).send('Failed to reject refund request');
    }
    logAdminActivity(req, 'BNPL_REFUND_REJECT', 'bnpl_refund', requestId, {});
    res.redirect('/admin/bnpl/refunds');
  });
};
