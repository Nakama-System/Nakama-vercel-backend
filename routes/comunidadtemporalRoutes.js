// ═══════════════════════════════════════════════════════════
// routes/comunidadtemporalRoutes.js — Nakama
// ═══════════════════════════════════════════════════════════

const express = require("express");
const router  = express.Router();
const { protect } = require("../middlewares/authMiddleware");
const {
  create,
  markViewed,
  destroy,
  getReceived,
  deleteForMember,
} = require("../controllers/temporalComunidadController");

// GET  /comunidadtemporal/received?roomId=xxx
router.get("/received", protect, getReceived);

// POST /comunidadtemporal
router.post("/", protect, create);

// POST /comunidadtemporal/:id/view
router.post("/:id/view", protect, markViewed);

// POST /comunidadtemporal/:id/destroy
router.post("/:id/destroy", protect, destroy);

// DELETE /comunidadtemporal/:id
router.delete("/:id", protect, deleteForMember);

module.exports = router;