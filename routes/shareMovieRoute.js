const express = require('express');
const router  = express.Router();
const { getShareMoviePage } = require('../controllers/shareMovieController');

router.get('/', getShareMoviePage);

module.exports = router;