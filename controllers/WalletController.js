const db = require('../db');
const paypal = require('../services/paypal');
const netsQr = require('../services/nets');
const WalletModel = require('../models/WalletModel');

const BONUS_THRESHOLD = 100;
const BONUS_AMOUNT = 5;

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
