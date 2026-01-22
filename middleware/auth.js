const ROLE_ORDER = {
  user: 1,
  storekeeper: 2,
  admin: 3
};

const requireAuth = (req, res, next) => {
  if (req.session && req.session.user) return next();
  req.flash('error', 'Please log in to view this resource');
  return res.redirect('/login');
};

const requireRole = (role) => (req, res, next) => {
  const user = req.session && req.session.user;
  if (user && user.role === role) return next();
  req.flash('error', 'Access denied');
  return res.redirect('/shopping');
};

const requireMinRole = (role) => (req, res, next) => {
  const user = req.session && req.session.user;
  if (user && ROLE_ORDER[user.role] >= ROLE_ORDER[role]) return next();
  req.flash('error', 'Access denied');
  return res.redirect('/shopping');
};

const exposeUser = (req, res, next) => {
  res.locals.user = req.session ? req.session.user : null;
  next();
};

module.exports = {
  ROLE_ORDER,
  requireAuth,
  requireRole,
  requireMinRole,
  exposeUser
};
