const bcrypt = require('bcrypt');
const crypto = require('crypto');

const hashPassword = async (plain) => bcrypt.hash(plain, 10);
const sha1 = (plain) => crypto.createHash('sha1').update(plain).digest('hex');

const UserController = {
  registerForm(req, res) {
    res.render('register', { messages: req.flash('error'), formData: req.flash('formData')[0] });
  },

  async register(req, res) {
    const db = require('../db');
    const { username, email, password, address, contact, pdpaAccepted } = req.body;
    const role = 'user';

    if (!username || !email || !password || !address || !contact) {
      req.flash('error', 'All fields are required.');
      req.flash('formData', req.body);
      return res.redirect('/register');
    }
    if (!pdpaAccepted) {
      req.flash('error', 'Please review and accept the PDPA notice to continue.');
      req.flash('formData', req.body);
      return res.redirect('/register');
    }
    if (password.length < 6) {
      req.flash('error', 'Password should be at least 6 or more characters long');
      req.flash('formData', req.body);
      return res.redirect('/register');
    }

    const passwordHash = await hashPassword(password);
    const sql = 'INSERT INTO users (username, email, password, address, contact, role) VALUES (?, ?, ?, ?, ?, ?)';
    db.query(sql, [username, email, passwordHash, address, contact, role], (err, result) => {
      if (err) {
        console.error('Error registering user:', err);
        req.flash('error', 'Registration failed. Try again.');
        return res.redirect('/register');
      }
      req.flash('success', 'Registration successful! Please log in.');
      return res.redirect('/login');
    });
  },

  loginForm(req, res) {
    res.render('login', { messages: req.flash('success'), errors: req.flash('error') });
  },

  login(req, res) {
    const db = require('../db');
    const { email, password } = req.body;

    if (!email || !password) {
      req.flash('error', 'All fields are required.');
      return res.redirect('/login');
    }

    const sql = 'SELECT * FROM users WHERE email = ? LIMIT 1';
    db.query(sql, [email], async (err, results) => {
      if (err) {
        console.error('Error logging in:', err);
        req.flash('error', 'Login failed.');
        return res.redirect('/login');
      }
      if (results.length === 0) {
        req.flash('error', 'Invalid email or password.');
        return res.redirect('/login');
      }

      const user = results[0];
      let valid = false;
      if (user.password && user.password.startsWith('$2')) {
        valid = await bcrypt.compare(password, user.password);
      } else {
        valid = sha1(password) === user.password;
        if (valid) {
          try {
            const newHash = await hashPassword(password);
            db.query('UPDATE users SET password = ? WHERE id = ?', [newHash, user.id], () => {});
          } catch (hashErr) {
            console.warn('Could not upgrade password hash:', hashErr);
          }
        }
      }

      if (!valid) {
        req.flash('error', 'Invalid email or password.');
        return res.redirect('/login');
      }

      req.session.user = user;
      req.flash('success', `Welcome back, ${req.session.user.username}!`);
      if (user.role === 'admin') return res.redirect('/admin/dashboard');
      if (user.role === 'storekeeper') return res.redirect('/storekeeper/dashboard');
      return res.redirect('/shopping');
    });
  },

  logout(req, res) {
    req.session.destroy(() => res.redirect('/'));
  }
};

module.exports = UserController;
