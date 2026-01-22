const express = require('express');
const session = require('express-session');
const flash = require('connect-flash');
const path = require('path');
const http = require('http');
const { Server } = require('socket.io');
try { require('dotenv').config(); } catch (err) { console.warn('dotenv not installed, skipping .env load'); }

const productRoutes = require('./routes/productRoutes');
const userRoutes = require('./routes/userRoutes');
const cartRoutes = require('./routes/cartRoutes');
const orderRoutes = require('./routes/orderRoutes');
const adminRoutes = require('./routes/adminRoutes');
const tradeRoutes = require('./routes/tradeRoutes');
const { exposeUser } = require('./middleware/auth');
const db = require('./db');
const Trade = require('./models/Trade');
const Product = require('./models/Product');
const Notification = require('./models/Notification');
const TradeMessage = require('./models/TradeMessage');
const TradeMeeting = require('./models/TradeMeeting');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
app.set('io', io);

// View engine and static files
app.set('view engine', 'ejs');
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: false }));

// Session + flash
app.use(session({
  secret: process.env.SESSION_SECRET || 'secret',
  resave: false,
  saveUninitialized: true,
  cookie: { maxAge: 1000 * 60 * 60 * 24 * 7 }
}));
app.use(flash());
app.use(exposeUser);

const runQuery = (sql, params = []) => new Promise((resolve, reject) => {
  db.query(sql, params, (err, rows) => {
    if (err) return reject(err);
    resolve(rows);
  });
});

const toPromise = (fn, ...args) =>
  new Promise((resolve, reject) =>
    fn(...args, (err, res) => (err ? reject(err) : resolve(res)))
  );

const groupByTradeId = (items) =>
  items.reduce((acc, item) => {
    if (!acc[item.trade_id]) acc[item.trade_id] = [];
    acc[item.trade_id].push(item);
    return acc;
  }, {});

io.on('connection', (socket) => {
  socket.on('join', ({ userId, tradeIds }) => {
    if (userId) socket.join(`user:${userId}`);
    socket.join('global');
    if (Array.isArray(tradeIds)) {
      tradeIds.forEach((id) => socket.join(`trade:${id}`));
    }
  });
});

// Routes
app.get('/', async (req, res) => {
  const user = req.session.user;
  if (user && user.role === 'admin') {
    return res.redirect('/admin/dashboard');
  }
  const success = req.flash('success');
  let stats = { totalTransactions: 0, totalUsers: 0, totalProducts: 0, totalTrades: 0 };
  let myTrades = [];
  let openTrades = [];
  let products = [];
  let userNotifications = [];
  let globalNotifications = [];
  let messagesByTradeId = {};
  let proposalsByTradeId = {};
  try {
    const [ordersRow, usersRow, productsRow, tradesRow] = await Promise.all([
      runQuery('SELECT COUNT(*) AS totalTransactions FROM orders'),
      runQuery('SELECT COUNT(*) AS totalUsers FROM users'),
      runQuery('SELECT COUNT(*) AS totalProducts FROM products'),
      runQuery('SELECT COUNT(*) AS totalTrades FROM trades')
    ]);
    stats = {
      totalTransactions: ordersRow[0]?.totalTransactions || 0,
      totalUsers: usersRow[0]?.totalUsers || 0,
      totalProducts: productsRow[0]?.totalProducts || 0,
      totalTrades: tradesRow[0]?.totalTrades || 0
    };
    if (user && user.role !== 'admin') {
      const [myTradesRes, openTradesRes, productsRes, userNotifsRes, globalNotifsRes] = await Promise.all([
        toPromise(Trade.listForUser, user.id),
        toPromise(Trade.listOpenForOthers, user.id),
        toPromise(Product.getActive),
        toPromise(Notification.listForUser, user.id, 8),
        toPromise(Notification.listGlobal, 8)
      ]);
      myTrades = myTradesRes;
      openTrades = openTradesRes;
      products = productsRes;
      userNotifications = userNotifsRes;
      globalNotifications = globalNotifsRes;

      const acceptedTradeIds = myTrades.filter(t => t.status === 'accepted').map(t => t.id);
      const [messagesList, proposalsList] = await Promise.all([
        toPromise(TradeMessage.listForTradeIds, acceptedTradeIds),
        toPromise(TradeMeeting.listForTradeIds, acceptedTradeIds)
      ]);
      messagesByTradeId = groupByTradeId(messagesList);
      proposalsByTradeId = groupByTradeId(proposalsList);
    }
  } catch (err) {
    console.error('Error fetching homepage stats:', err);
  }
  return res.render('index', {
    user,
    messages: success,
    stats,
    myTrades,
    openTrades,
    products,
    userNotifications,
    globalNotifications,
    messagesByTradeId,
    proposalsByTradeId
  });
});
app.use(productRoutes);
app.use(userRoutes);
app.use(cartRoutes);
app.use(orderRoutes);
app.use(adminRoutes);
app.use(tradeRoutes);

// Fallback
app.use((req, res) => res.status(404).send('Page not found'));

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
