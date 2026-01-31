const db = require('../db');

class BnplCardModel {
  static getByUserId(userId, callback) {
    const sql = `
      SELECT *
      FROM bnpl_cards
      WHERE user_id = ?
      LIMIT 1
    `;
    db.query(sql, [userId], (err, rows) => {
      if (err) return callback(err);
      callback(null, rows && rows[0] ? rows[0] : null);
    });
  }

  static upsertCard(userId, cardholderName, last4, expiry, billingAddress, callback) {
    const sql = `
      INSERT INTO bnpl_cards (user_id, cardholder_name, last4, expiry, billing_address, status)
      VALUES (?, ?, ?, ?, ?, 'ACTIVE')
      ON DUPLICATE KEY UPDATE
        cardholder_name = VALUES(cardholder_name),
        last4 = VALUES(last4),
        expiry = VALUES(expiry),
        billing_address = VALUES(billing_address),
        status = 'ACTIVE',
        updated_at = CURRENT_TIMESTAMP
    `;
    db.query(sql, [userId, cardholderName, last4, expiry, billingAddress], callback);
  }
}

module.exports = BnplCardModel;
