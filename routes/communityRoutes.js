// ═══════════════════════════════════════════════════════════
// routes/communityRoutes.js — Nakama  (v3 fixed)
// ═══════════════════════════════════════════════════════════

const express     = require("express");
const router      = express.Router();
const { protect } = require("../middlewares/authMiddleware");
const ctrl        = require("../controllers/communityController");

// protect en TODAS las rutas (una sola vez arriba, sin duplicar)
router.use(protect);

// ── Community CRUD ────────────────────────────────────────
router.get("/",    ctrl.getCommunities);
router.post("/",   ctrl.createCommunity);
router.get("/:id", ctrl.getCommunityById);

// ── Edit (admin only) ─────────────────────────────────────
router.patch("/:id",          ctrl.updateCommunity);
router.patch("/:id/rules",    ctrl.updateRules);
router.patch("/:id/settings", ctrl.updateSettings);   // ← fix: ahora guarda theme

// ── Like / Unlike ─────────────────────────────────────────
router.post("/:id/like",   ctrl.likeCommunity);
router.delete("/:id/like", ctrl.unlikeCommunity);

// ── Report ────────────────────────────────────────────────
router.post("/:id/report", ctrl.reportCommunity);

// ── Feed & messages ───────────────────────────────────────
router.get("/:id/feed",      ctrl.getFeed);
router.post("/:id/messages", ctrl.sendMessage);

// ── Join (cualquier usuario, si no está baneado) ──────────
router.post("/:id/join", ctrl.joinCommunity);
router.post("/:id/leave", ctrl.leaveCommunity);
// ── Invite new members (admin only) ──────────────────────
router.post("/:id/invite", ctrl.inviteMembers);

// ── Members list ─────────────────────────────────────────
// FIX: sin segundo `protect` — ya está aplicado arriba con router.use(protect)
router.get("/:id/members", ctrl.getCommunityMembers);

// ── Member management (admin only) ───────────────────────
router.patch("/:id/members/:memberId/role",     ctrl.updateMemberRole);
router.post("/:id/members/:memberId/star",      ctrl.addStar);
router.delete("/:id/members/:memberId/star",    ctrl.removeStar);
router.patch("/:id/members/:memberId/frame",    ctrl.updateFrame);
router.post("/:id/members/:memberId/freeze",    ctrl.freezeMember);
router.post("/:id/members/:memberId/unfreeze",  ctrl.unfreezeMember);
router.post("/:id/members/:memberId/shock",     ctrl.shockMember);
router.delete("/:id/members/:memberId",         ctrl.removeMember);

module.exports = router;