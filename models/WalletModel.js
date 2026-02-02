/* I will not copy or allow others to copy my code. 
 I understand that copying code is considered as plagiarism.
 
 Student Name: NGJINHENG 
 Student ID: 24024323 
 Class: C372-003-E63C
 Date created: 1/2/2026
  */
const db = require('../db');

class WalletModel {
  static ensureWallet(userId, callback) {
    const sql = `
      INSERT INTO wallets (user_id, balance)
      VALUES (?, 0.00)
      ON DUPLICATE KEY UPDATE user_id = user_id
    `;
    db.query(sql, [userId], callback);
  }

  static getBalance(userId, callback) {
    const sql = `
      SELECT balance
      FROM wallets
      WHERE user_id = ?
    `;
    db.query(sql, [userId], (err, rows) => {
      if (err) return callback(err);
      if (!rows.length) return callback(null, 0.0);
      callback(null, Number(rows[0].balance));
    });
  }

  static credit(userId, amount, type, reference = null, callback) {
    if (amount <= 0) return callback(new Error('Credit amount must be positive'));

    db.beginTransaction(err => {
      if (err) return callback(err);

      const updateBalance = `
        UPDATE wallets
        SET balance = balance + ?
        WHERE user_id = ?
      `;
      const insertTxn = `
        INSERT INTO wallet_transactions
        (user_id, type, amount, reference)
        VALUES (?, ?, ?, ?)
      `;

      db.query(updateBalance, [amount, userId], err1 => {
        if (err1) return db.rollback(() => callback(err1));
        db.query(insertTxn, [userId, type, amount, reference], err2 => {
          if (err2) return db.rollback(() => callback(err2));
          db.commit(err3 => {
            if (err3) return db.rollback(() => callback(err3));
            callback(null);
          });
        });
      });
    });
  }

  static debit(userId, amount, reference = null, callback) {
    if (amount <= 0) return callback(new Error('Debit amount must be positive'));

    db.beginTransaction(err => {
      if (err) return callback(err);

      const checkBalance = `
        SELECT balance
        FROM wallets
        WHERE user_id = ?
        FOR UPDATE
      `;
      const updateBalance = `
        UPDATE wallets
        SET balance = balance - ?
        WHERE user_id = ?
      `;
      const insertTxn = `
        INSERT INTO wallet_transactions
        (user_id, type, amount, reference)
        VALUES (?, 'PAYMENT', ?, ?)
      `;

      db.query(checkBalance, [userId], (err1, rows) => {
        if (err1 || !rows.length) {
          return db.rollback(() => callback(err1 || new Error('Wallet not found')));
        }
        const currentBalance = Number(rows[0].balance);
        if (currentBalance < amount) {
          return db.rollback(() => callback(new Error('Insufficient wallet balance')));
        }

        db.query(updateBalance, [amount, userId], err2 => {
          if (err2) return db.rollback(() => callback(err2));
          db.query(insertTxn, [userId, -amount, reference], err3 => {
            if (err3) return db.rollback(() => callback(err3));
            db.commit(err4 => {
              if (err4) return db.rollback(() => callback(err4));
              callback(null);
            });
          });
        });
      });
    });
  }

  static getTransactions(userId, callback) {
    const sql = `
      SELECT *
      FROM wallet_transactions
      WHERE user_id = ?
      ORDER BY created_at DESC
    `;
    db.query(sql, [userId], callback);
  }
}

module.exports = WalletModel;
