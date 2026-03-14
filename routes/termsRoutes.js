// ═══════════════════════════════════════════════════════════
// routes/termsRoutes.js — Nakama
// ═══════════════════════════════════════════════════════════

const express = require("express");
const {
  getActiveTerms,
  getAllVersions,
  createDraft,
  updateDraft,
  publishTerms,
  acceptTerms,
} = require("../controllers/termsController");

const {
  authenticate,
  superadminOnly,
  adminOrAbove,
} = require("../middlewares/requireRole");

const router = express.Router();

// ── Público ────────────────────────────────────────────────
router.get("/active", getActiveTerms);

// ── Solo superadmin ────────────────────────────────────────
router.get(  "/all",          authenticate, superadminOnly, getAllVersions);
router.post( "/draft",        authenticate, superadminOnly, createDraft);
router.patch("/draft/:id",    authenticate, superadminOnly, updateDraft);
router.post( "/publish/:id",  authenticate, superadminOnly, publishTerms);

// ── Usuario autenticado ────────────────────────────────────
router.post("/accept", authenticate, acceptTerms);

module.exports = router;