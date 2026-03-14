// ═══════════════════════════════════════════════════════════
// routes/superadminRoutes.js
// ═══════════════════════════════════════════════════════════
const express = require("express");
const router  = express.Router();
const {
  revealLogin,
  getDashboardStats,
  getUsers,
  freezeUser,
  unfreezeUser,
  banUser,
  unbanUser,
  deleteUser,
  getCommunities,
  deleteCommunity,
  freezeCommunity,
  getReports,
  resolveReport,
  getTerms,
  updateTerms,
  getPrivacy,
  updatePrivacy,
  kickAllSessions,
} = require("../controllers/superadminController");
const { superadminAuth } = require("../middlewares/superadminAuth");

// ── Auth especial (no requiere superadminAuth) ─────────────
router.post("/reveal", revealLogin);

// ── Todo lo demás requiere el token superadmin ─────────────
router.use(superadminAuth);

router.get ("/stats",                   getDashboardStats);
router.get ("/users",                   getUsers);
router.post("/users/:id/freeze",        freezeUser);
router.post("/users/:id/unfreeze",      unfreezeUser);
router.post("/users/:id/ban",           banUser);
router.post("/users/:id/unban",         unbanUser);
router.delete("/users/:id",             deleteUser);
router.get ("/communities",             getCommunities);
router.delete("/communities/:id",       deleteCommunity);
router.post("/communities/:id/freeze",  freezeCommunity);
router.get ("/reports",                 getReports);
router.post("/reports/:id/resolve",     resolveReport);
router.get ("/terms",                   getTerms);
router.put ("/terms",                   updateTerms);
router.get ("/privacy",                 getPrivacy);
router.put ("/privacy",                 updatePrivacy);
router.post("/kick-sessions",           kickAllSessions);

module.exports = router;