/* I will not copy or allow others to copy my code. 
 I understand that copying code is considered as plagiarism.
 
 Student Name: NGJINHENG 
 Student ID: 24024323 
 Class: C372-003-E63C
 Date created: 1/2/2026
  */
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
