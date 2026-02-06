const ADMIN_KEY = process.env.ADMIN_SIGNUP_KEY || 'admin';

module.exports = function requireAdminKey(req, res, next) {
  const provided = (req.body && req.body.adminKey) || (req.query && req.query.adminKey) || '';
  if (String(provided) !== String(ADMIN_KEY)) {
    const message = 'Invalid admin key. Action not authorised.';
    if (req.flash) {
      req.flash('error', message);
    }
    if (req.path && req.path.endsWith('.csv')) {
      return res.status(403).send(message);
    }
    const back = req.get('Referrer') || '/admin/dashboard';
    return res.redirect(back);
  }
  return next();
};
