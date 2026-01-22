const db = require('../db');

const TradeMeeting = {
  getById(id, callback) {
    const sql = `
      SELECT * FROM trade_meeting_proposals
      WHERE id = ?
    `;
    db.query(sql, [id], (err, results) => callback(err, results && results[0] ? results[0] : null));
  },

  listForTradeIds(tradeIds, callback) {
    if (!tradeIds || tradeIds.length === 0) return callback(null, []);
    const sql = `
      SELECT mp.*, u.username AS proposerUsername, ur.username AS responderUsername
      FROM trade_meeting_proposals mp
      LEFT JOIN users u ON mp.proposer_id = u.id
      LEFT JOIN users ur ON mp.responded_by = ur.id
      WHERE mp.trade_id IN (?)
      ORDER BY mp.created_at ASC
    `;
    db.query(sql, [tradeIds], (err, results) => callback(err, results));
  },

  propose({ tradeId, proposerId, proposedAt }, callback) {
    const sql = `
      INSERT INTO trade_meeting_proposals (trade_id, proposer_id, proposed_at)
      VALUES (?, ?, ?)
    `;
    db.query(sql, [tradeId, proposerId, proposedAt], (err, result) => callback(err, result));
  },

  respond({ proposalId, responderId, status }, callback) {
    const sql = `
      UPDATE trade_meeting_proposals
      SET status = ?, responded_by = ?, responded_at = NOW()
      WHERE id = ?
    `;
    db.query(sql, [status, responderId, proposalId], (err, result) => callback(err, result));
  }
};

module.exports = TradeMeeting;
