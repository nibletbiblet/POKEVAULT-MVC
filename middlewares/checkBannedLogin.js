const db = require('../db');

module.exports = (req, res, next) => {
  try {
    const email = (req.body && req.body.email ? String(req.body.email) : '').trim();
    if (!email) return next();

    const sql = 'SELECT id, email, isBanned, banReason FROM users WHERE email = ? LIMIT 1';
    db.query(sql, [email], (err, rows) => {
      if (err) {
        console.error('checkBannedLogin error:', err);
        return next();
      }
      if (!rows || !rows.length) return next();

      const user = rows[0];
      const isBanned = user.isBanned === true || user.isBanned === 1 || user.isBanned === '1';
      if (!isBanned) return next();

      return res.status(403).render('loginSuspended', {
        email: user.email,
        reason: user.banReason || null
      });
    });
  } catch (err) {
    console.error('checkBannedLogin exception:', err);
    return next();
  }
};
