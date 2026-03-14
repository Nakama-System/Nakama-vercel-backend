// ═══════════════════════════════════════════════════════════
// routes/moderationRoutes.js — Nakama
// ═══════════════════════════════════════════════════════════

const express = require("express");
const {
  banUser,
  unbanUser,
  suspendUser,
  unsuspendUser,
  flagContent,
  getPendingFlags,
  getUserModerationHistory,
} = require("../controllers/moderationController");

const {
  authenticate,
  moderatorOrAbove,
  adminOrAbove,
} = require("../middlewares/requireRole");

const router = express.Router();

// Todas las rutas requieren al menos moderador
router.use(authenticate);

// ── Ban/Unban — admin o superadmin ────────────────────────
router.post(  "/ban/:userId",   adminOrAbove, banUser);
router.post(  "/unban/:userId", adminOrAbove, unbanUser);

// ── Suspend/Unsuspend — moderador o superior ──────────────
router.post(  "/suspend/:userId",   moderatorOrAbove, suspendUser);
router.post(  "/unsuspend/:userId", moderatorOrAbove, unsuspendUser);

// ── Contenido ─────────────────────────────────────────────
router.post(  "/flag-content",             moderatorOrAbove, flagContent);
router.get(   "/flags",                    moderatorOrAbove, getPendingFlags);
router.get(   "/user/:userId/history",     adminOrAbove,     getUserModerationHistory);

module.exports = router;