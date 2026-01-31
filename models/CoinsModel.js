const db = require('../db');

class CoinsModel {
  static ensureCoins(userId, callback) {
    const sql = `
      INSERT INTO pokevault_coins (user_id, balance)
      VALUES (?, 0.00)
      ON DUPLICATE KEY UPDATE user_id = user_id
    `;
    db.query(sql, [userId], callback);
  }

  static getBalance(userId, callback) {
    const sql = `
      SELECT balance
      FROM pokevault_coins
      WHERE user_id = ?
    `;
    db.query(sql, [userId], (err, rows) => {
      if (err) return callback(err);
      if (!rows.length) return callback(null, 0.0);
      callback(null, Number(rows[0].balance));
    });
  }

  static credit(userId, amount, callback) {
    if (amount <= 0) return callback(null);

    db.beginTransaction(err => {
      if (err) return callback(err);

      const updateBalance = `
        UPDATE pokevault_coins
        SET balance = balance + ?
        WHERE user_id = ?
      `;
      db.query(updateBalance, [amount, userId], err1 => {
        if (err1) return db.rollback(() => callback(err1));
        db.commit(err2 => {
          if (err2) return db.rollback(() => callback(err2));
          callback(null);
        });
      });
    });
  }

  static debit(userId, amount, callback) {
    if (amount <= 0) return callback(null);

    db.beginTransaction(err => {
      if (err) return callback(err);

      const checkBalance = `
        SELECT balance
      FROM pokevault_coins
      WHERE user_id = ?
      FOR UPDATE
      `;
      const updateBalance = `
        UPDATE pokevault_coins
        SET balance = balance - ?
        WHERE user_id = ?
      `;

      db.query(checkBalance, [userId], (err1, rows) => {
        if (err1 || !rows.length) {
          return db.rollback(() => callback(err1 || new Error('Coins wallet not found')));
        }
        const currentBalance = Number(rows[0].balance);
        if (currentBalance < amount) {
          return db.rollback(() => callback(new Error('Insufficient FairPrice Coins balance')));
        }
        db.query(updateBalance, [amount, userId], err2 => {
          if (err2) return db.rollback(() => callback(err2));
          db.commit(err3 => {
            if (err3) return db.rollback(() => callback(err3));
            callback(null);
          });
        });
      });
    });
  }
}

module.exports = CoinsModel;
