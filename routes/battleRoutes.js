// ═══════════════════════════════════════════════════════════
// routes/battleRoutes.js — Nakama
// ═══════════════════════════════════════════════════════════


const express     = require("express");
const router      = express.Router();
const { protect } = require("../middlewares/authMiddleware");
const ctrl        = require("../controllers/battleController");
 
router.use(protect);
 
router.post("/create",           ctrl.createBattle);
router.post("/:roomId/accept",   ctrl.acceptBattle);
router.post("/:roomId/decline",  ctrl.declineBattle);
router.post("/:roomId/start",    ctrl.startBattle);
router.get("/:roomId/result",    ctrl.getBattleResult);  // ← nuevo: stats completos post-batalla
router.get("/:roomId",           ctrl.getBattle);
 
module.exports = router;
 