/**
 * Review model for per-product reviews.
 * Table fields: id, productId, userId (nullable), name, rating, comment, createdAt
 */
const db = require('../db');

const Review = {
  add(review, callback) {
    const sql = `
      INSERT INTO reviews (productId, userId, name, rating, comment)
      VALUES (?, ?, ?, ?, ?)
    `;
    const params = [
      review.productId,
      review.userId || null,
      review.name,
      review.rating,
      review.comment
    ];
    db.query(sql, params, (err, result) => callback(err, result));
  },

  getByProduct(productId, callback) {
    const sql = `
      SELECT r.id, r.productId, r.userId, r.name, r.rating, r.comment, r.createdAt
      FROM reviews r
      WHERE r.productId = ?
      ORDER BY r.createdAt DESC
    `;
    db.query(sql, [productId], (err, rows) => callback(err, rows || []));
  },

  getStats(productId, callback) {
    const sql = `
      SELECT COUNT(*) AS count, ROUND(AVG(rating), 1) AS avg
      FROM reviews
      WHERE productId = ?
    `;
    db.query(sql, [productId], (err, rows) => {
      if (err) return callback(err);
      const row = rows && rows[0] ? rows[0] : { count: 0, avg: null };
      callback(null, { count: row.count || 0, avg: row.avg || 0 });
    });
  },

  getById(id, callback) {
    const sql = `
      SELECT id, productId, userId, name, rating, comment, createdAt
      FROM reviews
      WHERE id = ?
    `;
    db.query(sql, [id], (err, rows) => {
      if (err) return callback(err);
      callback(null, rows && rows[0] ? rows[0] : null);
    });
  },

  deleteById(id, callback) {
    const sql = 'DELETE FROM reviews WHERE id = ?';
    db.query(sql, [id], (err, result) => callback(err, result));
  },

  // Stats for all products in one query: returns an object keyed by productId
  getStatsByProduct(callback) {
    const sql = `
      SELECT productId, COUNT(*) AS count, ROUND(AVG(rating), 1) AS avg
      FROM reviews
      GROUP BY productId
    `;
    db.query(sql, (err, rows) => {
      if (err) return callback(err);
      const map = {};
      (rows || []).forEach(r => {
        map[r.productId] = {
          count: r.count || 0,
          avg: r.avg || 0
        };
      });
      callback(null, map);
    });
  }
};

module.exports = Review;
