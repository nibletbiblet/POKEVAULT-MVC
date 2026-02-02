const CoinsModel = require('../models/CoinsModel');
const Order = require('../models/Order');
const { FAIRPRICE_COIN_RATE } = require('../config/constants');

function round2(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function getAppliedCoins(req, userId, orderTotal, callback) {
  const requested = Number(req.session.coinsApplied || 0);
  if (requested <= 0) return callback(null, 0);

  CoinsModel.getBalance(userId, (err, balance) => {
    if (err) return callback(err);
    const applied = Math.min(requested, balance, orderTotal);
    callback(null, round2(applied));
  });
}

function applyCoinsToOrder(req, userId, orderId, orderTotal, callback) {
  getAppliedCoins(req, userId, orderTotal, (err, coinsUsed) => {
    if (err) return callback(err);
    if (coinsUsed <= 0) return callback(null, orderTotal, 0);

    CoinsModel.debit(userId, coinsUsed, (err2) => {
      if (err2) return callback(err2);
      const newTotal = round2(orderTotal - coinsUsed);
      Order.updateTotal(orderId, newTotal, (err3) => {
        if (err3) return callback(err3);
        req.session.coinsApplied = 0;
        callback(null, newTotal, coinsUsed);
      });
    });
  });
}

function creditCoins(userId, paidAmount, callback) {
  const earn = round2(Number(paidAmount) * FAIRPRICE_COIN_RATE);
  if (earn <= 0) return callback(null);
  CoinsModel.credit(userId, earn, callback);
}

module.exports = {
  round2,
  getAppliedCoins,
  applyCoinsToOrder,
  creditCoins
};
