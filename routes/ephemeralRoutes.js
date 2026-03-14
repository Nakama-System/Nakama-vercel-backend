// routes/ephemeralRoutes.js
const express = require("express");
const router  = express.Router();
const { protect } = require("../middlewares/authMiddleware");
const {
  create,
  markViewed,
  destroy,
  getReceived,
} = require("../controllers/ephemeralController");

// GET  /ephemeral/received     ← mensajes pendientes al reconectar
router.get("/received", protect, getReceived);

// POST /ephemeral              ← crear mensaje temporal
router.post("/", protect, create);

// POST /ephemeral/:id/view     ← marcar como visto
router.post("/:id/view", protect, markViewed);

// POST /ephemeral/:id/destroy  ← destruir
router.post("/:id/destroy", protect, destroy);

module.exports = router;