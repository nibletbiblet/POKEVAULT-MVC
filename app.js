const express = require('express');
const path = require('path');
const app = express();
const PORT = 3000;

// Middleware
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// View engine setup
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Routes
const pokemonRoutes = require('./routes/pokemonRoutes');
app.use('/', pokemonRoutes);

// Start server
app.listen(PORT, () => {
  console.log(`✅ PokéVault app running at http://localhost:${PORT}`);
});
