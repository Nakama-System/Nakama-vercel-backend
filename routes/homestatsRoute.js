const express = require("express");
const router = express.Router();
const { getHomeStats } = require("../controllers/homestatsController");

// GET /api/homestats
router.get("/", getHomeStats);

module.exports = router;