const express = require('express');
const router = express.Router();
const pokemonController = require('../controllers/pokemonController');

router.get('/', pokemonController.showHome);

module.exports = router;
