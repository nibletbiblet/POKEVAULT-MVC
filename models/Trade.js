/**
 * Trade model encapsulating basic CRUD for user-to-user trades.
 * Table schema expected:
 *   id INT PK AI,
 *   initiator_id INT NOT NULL,
 *   initiator_product_id INT NOT NULL,
 *   responder_id INT NULL,
 *   responder_product_id INT NULL,
 *   status ENUM('open','pending_initiator','accepted','declined','cancelled') DEFAULT 'open',
 *   note VARCHAR(255) NULL,
 *   created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
 *   updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
 */

const db = require('../db');

const Trade = {
  create({ initiatorId, initiatorProductId, note }, callback) {
    const sql = 'INSERT INTO trades (initiator_id, initiator_product_id, note) VALUES (?, ?, ?)';
    db.query(sql, [initiatorId, initiatorProductId, note || null], (err, result) => callback(err, result));
  },

  findById(id, callback) {
    const sql = `
      SELECT t.*, u1.username AS initiatorUsername, u2.username AS responderUsername
      FROM trades t
      LEFT JOIN users u1 ON t.initiator_id = u1.id
      LEFT JOIN users u2 ON t.responder_id = u2.id
      WHERE t.id = ?
    `;
    db.query(sql, [id], (err, results) => callback(err, results && results[0] ? results[0] : null));
  },

  listForUser(userId, callback) {
    const sql = `
      SELECT
        t.*,
        p1.productName AS initiatorProductName,
        p2.productName AS responderProductName,
        u1.username AS initiatorUsername,
        u2.username AS responderUsername
      FROM trades t
      LEFT JOIN products p1 ON t.initiator_product_id = p1.id
      LEFT JOIN products p2 ON t.responder_product_id = p2.id
      LEFT JOIN users u1 ON t.initiator_id = u1.id
      LEFT JOIN users u2 ON t.responder_id = u2.id
      WHERE t.initiator_id = ? OR t.responder_id = ?
      ORDER BY t.updated_at DESC, t.created_at DESC
    `;
    db.query(sql, [userId, userId], (err, results) => callback(err, results));
  },

  listOpenForOthers(userId, callback) {
    const sql = `
      SELECT
        t.*,
        p1.productName AS initiatorProductName,
        u1.username AS initiatorUsername
      FROM trades t
      LEFT JOIN products p1 ON t.initiator_product_id = p1.id
      LEFT JOIN users u1 ON t.initiator_id = u1.id
      WHERE t.status = 'open' AND t.responder_id IS NULL AND t.initiator_id != ?
      ORDER BY t.created_at DESC
    `;
    db.query(sql, [userId], (err, results) => callback(err, results));
  },

  listAll(callback) {
    const sql = `
      SELECT
        t.*,
        p1.productName AS initiatorProductName,
        p2.productName AS responderProductName,
        u1.username AS initiatorUsername,
        u2.username AS responderUsername
      FROM trades t
      LEFT JOIN products p1 ON t.initiator_product_id = p1.id
      LEFT JOIN products p2 ON t.responder_product_id = p2.id
      LEFT JOIN users u1 ON t.initiator_id = u1.id
      LEFT JOIN users u2 ON t.responder_id = u2.id
      ORDER BY t.updated_at DESC, t.created_at DESC
    `;
    db.query(sql, (err, results) => callback(err, results));
  },

  offer({ tradeId, responderId, responderProductId, note }, callback) {
    const sql = `
      UPDATE trades
      SET responder_id = ?, responder_product_id = ?, note = COALESCE(?, note), status = 'pending_initiator', updated_at = NOW()
      WHERE id = ? AND status = 'open'
    `;
    db.query(sql, [responderId, responderProductId, note || null, tradeId], (err, result) => callback(err, result));
  },

  updateStatus({ tradeId, status }, callback) {
    const sql = 'UPDATE trades SET status = ?, updated_at = NOW() WHERE id = ?';
    db.query(sql, [status, tradeId], (err, result) => callback(err, result));
  }
};

module.exports = Trade;
