const db = require('../db');

const TradeMessage = {
  listForTradeIds(tradeIds, callback) {
    if (!tradeIds || tradeIds.length === 0) return callback(null, []);
    const sql = `
      SELECT m.*, u.username AS senderUsername
      FROM trade_messages m
      LEFT JOIN users u ON m.sender_id = u.id
      WHERE m.trade_id IN (?)
      ORDER BY m.created_at ASC
    `;
    db.query(sql, [tradeIds], (err, results) => callback(err, results));
  },

  add({ tradeId, senderId, message }, callback) {
    const sql = `
      INSERT INTO trade_messages (trade_id, sender_id, message)
      VALUES (?, ?, ?)
    `;
    db.query(sql, [tradeId, senderId, message], (err, result) => callback(err, result));
  }
};

module.exports = TradeMessage;
