/* I will not copy or allow others to copy my code. 
 I understand that copying code is considered as plagiarism.
 
 Student Name: NGJINHENG 
 Student ID: 24024323 
 Class: C372-003-E63C
 Date created: 1/2/2026
  */
const db = require('../db');
const paypal = require('../services/paypal');
const netsQr = require('../services/nets');
const WalletModel = require('../models/WalletModel');
const Stripe = require('stripe');

const BONUS_THRESHOLD = 100;
const BONUS_AMOUNT = 5;
const STRIPE_SECRET =
  process.env.STRIPE_SECRET_KEY ||
  process.env.STRIPE_SECRET ||
  process.env['Stripe.apiKey'];
const stripe = STRIPE_SECRET ? Stripe(STRIPE_SECRET) : null;

const buildBaseUrl = (req) => `${req.protocol}://${req.get('host')}`;

const computeBonus = (amount) => (amount >= BONUS_THRESHOLD ? BONUS_AMOUNT : 0);

exports.walletPage = (req, res) => {
  const userId = req.session.user.id;

  WalletModel.ensureWallet(userId, (err) => {
    if (err) {
      console.error(err);
      return res.status(500).send('Failed to load wallet');
    }

    WalletModel.getBalance(userId, (err2, balance) => {
      if (err2) {
        console.error(err2);
        return res.status(500).send('Failed to load wallet');
      }

      WalletModel.getTransactions(userId, (err3, transactions) => {
        if (err3) {
          console.error(err3);
          return res.status(500).send('Failed to load wallet history');
        }

        res.render('wallet/index', {
          balance: Number(balance || 0),
          transactions: transactions || []
        });
      });
    });
  });
};

exports.topupPage = (req, res) => {
  res.render('wallet/topup', {
    bonusThreshold: BONUS_THRESHOLD,
    bonusAmount: BONUS_AMOUNT
  });
};

exports.topupConfirm = (req, res) => {
  const amount = Number(req.body.amount);

  if (!amount || amount <= 0) {
    req.flash('error', 'Invalid top up amount');
    return res.redirect('/wallet/topup');
  }

  const bonus = computeBonus(amount);
  req.session.walletTopup = {
    type: 'WALLET_TOPUP',
    amount,
    bonus,
    totalCoins: amount + bonus
  };

  return res.redirect('/wallet/topup/payment');
};

exports.topupPaymentPage = (req, res) => {
  const topup = req.session.walletTopup;
  if (!topup) {
    return res.redirect('/wallet/topup');
  }

  res.render('wallet/topupPayment', { topup });
};

exports.topupPaypalCreate = async (req, res) => {
  const topup = req.session.walletTopup;
  if (!topup) {
    return res.status(400).json({ error: 'Invalid top-up session' });
  }

  try {
    const order = await paypal.createOrder(topup.amount);
    return res.json({ id: order.id });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to create PayPal order' });
  }
};

exports.topupPaypalCapture = async (req, res) => {
  const { orderID } = req.body;
  const topup = req.session.walletTopup;
  const userId = req.session.user.id;

  if (!orderID || !topup) {
    return res.status(400).json({ error: 'Invalid top-up session' });
  }

  try {
    const capture = await paypal.captureOrder(orderID);
    if (!capture || capture.status !== 'COMPLETED') {
      return res.status(400).json({ error: 'Payment not completed' });
    }

    const totalCoins = topup.amount + (topup.bonus || 0);

    WalletModel.ensureWallet(userId, (ensureErr) => {
      if (ensureErr) {
        console.error(ensureErr);
        return res.status(500).json({ error: 'Failed to prepare wallet' });
      }

      WalletModel.credit(userId, totalCoins, 'TOP_UP', capture.id, (err) => {
        if (err) {
          console.error(err);
          return res.status(500).json({ error: 'Failed to credit wallet' });
        }

        const sql = `
          SELECT id
          FROM wallet_transactions
          WHERE user_id = ? AND type = 'TOP_UP'
          ORDER BY created_at DESC
          LIMIT 1
        `;

        db.query(sql, [userId], (err2, rows) => {
          req.session.walletTopup = null;

          if (err2 || !rows.length) {
            return res.json({ redirect: '/wallet' });
          }

          return res.json({ redirect: `/wallet/receipt/${rows[0].id}` });
        });
      });
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Wallet top-up failed' });
  }
};

exports.topupStripeCreateSession = async (req, res) => {
  const topup = req.session.walletTopup;
  const user = req.session.user;
  if (!stripe) {
    return res.status(500).json({ error: 'Stripe is not configured.' });
  }
  if (!topup) {
    return res.status(400).json({ error: 'Invalid top-up session' });
  }
  const amount = Number(topup.amount || 0);
  if (!amount || amount <= 0) {
    return res.status(400).json({ error: 'Invalid top-up amount' });
  }

  const paymentMethodsRaw = (process.env.STRIPE_PAYMENT_METHODS || '').trim();
  const paymentMethodsLower = paymentMethodsRaw.toLowerCase();
  const paymentMethodTypes = paymentMethodsRaw && !['auto', 'all', 'default'].includes(paymentMethodsLower)
    ? paymentMethodsRaw.split(',').map((val) => val.trim()).filter(Boolean)
    : null;

  try {
    const sessionParams = {
      mode: 'payment',
      line_items: [
        {
          price_data: {
            currency: 'sgd',
            product_data: {
              name: 'PokeVault Pay Top-Up',
              description: topup.bonus ? `Bonus +$${Number(topup.bonus).toFixed(2)}` : undefined
            },
            unit_amount: Math.round(amount * 100)
          },
          quantity: 1
        }
      ],
      success_url: `${buildBaseUrl(req)}/wallet/topup/stripe/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${buildBaseUrl(req)}/wallet/topup/stripe/cancel`,
      customer_email: user.email || undefined,
      client_reference_id: String(user.id),
      metadata: {
        userId: String(user.id),
        topupAmount: String(topup.amount || 0),
        bonus: String(topup.bonus || 0),
        totalCoins: String(topup.totalCoins || 0)
      }
    };
    if (paymentMethodTypes && paymentMethodTypes.length) {
      sessionParams.payment_method_types = paymentMethodTypes;
    }

    const session = await stripe.checkout.sessions.create(sessionParams);
    return res.json({ id: session.id, url: session.url });
  } catch (err) {
    console.error('Stripe top-up session error:', err);
    return res.status(500).json({ error: 'Failed to start Stripe checkout.' });
  }
};

exports.topupStripeSuccess = async (req, res) => {
  const user = req.session.user;
  const sessionId = req.query.session_id;
  if (!stripe) {
    req.flash('error', 'Stripe is not configured.');
    return res.redirect('/wallet/topup');
  }
  if (!sessionId) {
    req.flash('error', 'Missing Stripe session.');
    return res.redirect('/wallet/topup');
  }

  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    if (!session || session.payment_status !== 'paid') {
      req.flash('error', 'Stripe payment not completed.');
      return res.redirect('/wallet/topup/payment');
    }

    const reference = session.payment_intent || session.id;
    const topupFromSession = req.session.walletTopup;
    const amount = Number(topupFromSession?.amount || session.metadata?.topupAmount || 0);
    const bonus = Number(topupFromSession?.bonus || session.metadata?.bonus || 0);
    const totalCoins = Number(topupFromSession?.totalCoins || session.metadata?.totalCoins || 0) || (amount + bonus);

    if (!amount || amount <= 0) {
      req.flash('error', 'Invalid top-up details.');
      return res.redirect('/wallet/topup');
    }

    const userId = user.id;
    const checkSql = `
      SELECT id
      FROM wallet_transactions
      WHERE user_id = ? AND reference = ?
      LIMIT 1
    `;
    db.query(checkSql, [userId, reference], (checkErr, rows) => {
      if (checkErr) {
        console.error(checkErr);
      }
      if (rows && rows.length) {
        req.session.walletTopup = null;
        return res.redirect(`/wallet/receipt/${rows[0].id}`);
      }

      WalletModel.ensureWallet(userId, (ensureErr) => {
        if (ensureErr) {
          console.error(ensureErr);
          req.flash('error', 'Failed to prepare wallet.');
          return res.redirect('/wallet');
        }

        WalletModel.credit(userId, totalCoins, 'TOP_UP', reference, (err) => {
          if (err) {
            console.error(err);
            req.flash('error', 'Failed to credit wallet.');
            return res.redirect('/wallet');
          }

          const receiptSql = `
            SELECT id
            FROM wallet_transactions
            WHERE user_id = ? AND reference = ?
            ORDER BY created_at DESC
            LIMIT 1
          `;
          db.query(receiptSql, [userId, reference], (err2, rows2) => {
            req.session.walletTopup = null;
            if (err2 || !rows2.length) {
              return res.redirect('/wallet');
            }
            return res.redirect(`/wallet/receipt/${rows2[0].id}`);
          });
        });
      });
    });
  } catch (err) {
    console.error('Stripe top-up success error:', err);
    req.flash('error', 'Stripe payment verification failed.');
    return res.redirect('/wallet/topup');
  }
};

exports.topupStripeCancel = (req, res) => {
  req.flash('error', 'Stripe top-up was canceled.');
  return res.redirect('/wallet/topup/payment');
};

exports.topupNets = (req, res) => {
  const topup = req.session.walletTopup;
  if (!topup) {
    return res.redirect('/wallet');
  }

  req.session.netsPayment = {
    type: 'WALLET_TOPUP',
    amount: topup.amount,
    bonus: topup.bonus || 0
  };

  req.body.cartTotal = topup.amount;
  return netsQr.generateQrCode(req, res);
};

exports.receiptPage = (req, res) => {
  const userId = req.session.user.id;
  const txnId = req.params.id;

  const sql = `
    SELECT *
    FROM wallet_transactions
    WHERE id = ? AND user_id = ?
    LIMIT 1
  `;

  db.query(sql, [txnId, userId], (err, rows) => {
    if (err || !rows.length) {
      return res.status(404).send('Receipt not found');
    }

    res.render('wallet/receipt', { txn: rows[0] });
  });
};
