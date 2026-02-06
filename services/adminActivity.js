const db = require('../db');

const safeStringify = (value) => {
  if (value === undefined) return null;
  try {
    const json = JSON.stringify(value);
    return json && json.length > 4000 ? json.slice(0, 4000) : json;
  } catch (err) {
    return null;
  }
};

const isIgnorableError = (err) => {
  return err && (err.code === 'ER_NO_SUCH_TABLE' || err.code === 'ER_BAD_FIELD_ERROR');
};

const logAdminActivity = (req, action, entityType, entityId, details) => {
  try {
    const admin = req && req.session ? req.session.user : null;
    if (!admin || admin.role !== 'admin') return;
    const sql = `
      INSERT INTO admin_activity
        (admin_id, action, entity_type, entity_id, details, ip, user_agent)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `;
    const params = [
      admin.id,
      action,
      entityType,
      entityId || null,
      safeStringify(details),
      req.ip || null,
      (req.headers && req.headers['user-agent']) ? String(req.headers['user-agent']).slice(0, 255) : null
    ];
    db.query(sql, params, (err) => {
      if (err && !isIgnorableError(err)) {
        console.error('Admin activity log failed:', err);
      }
    });
  } catch (err) {
    console.error('Admin activity logger error:', err);
  }
};

module.exports = {
  logAdminActivity
};
