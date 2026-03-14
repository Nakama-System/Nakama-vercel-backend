// ═══════════════════════════════════════════════════════════
// routes/moviesUpRoutes.js — Nakama | Movies
// Montado en:  app.use("/moviesup", moviesUpRoutes)
// ═══════════════════════════════════════════════════════════

const express = require("express");
const router  = express.Router();
const {
  protect,
  optionalAuth,   // middleware que decodifica token si existe, pero no falla si no hay
  requireRole,
} = require("../middlewares/authMiddleware");
const ctrl = require("../controllers/peliController");

// ── Rutas públicas con auth opcional ─────────────────────────
// optionalAuth: si hay token lo decodifica (req.user disponible),
// si no hay token simplemente sigue sin error.
// Así admins autenticados pueden ver pelis no publicadas.
router.get("/",             optionalAuth, ctrl.getMovies);
router.get("/:id/share",    ctrl.getShareMeta);
router.get("/:id",          optionalAuth, ctrl.getMovieById);

// ── Rutas que requieren login ─────────────────────────────────
router.post("/:id/vote",     protect, ctrl.voteMovie);
router.post("/:id/download", protect, ctrl.downloadMovie);

// ── CRUD — solo admins ────────────────────────────────────────
router.post(  "/",    protect, requireRole("superadmin", "admin"), ctrl.createMovie);
router.put(   "/:id", protect, requireRole("superadmin", "admin"), ctrl.updateMovie);
router.delete("/:id", protect, requireRole("superadmin"),          ctrl.deleteMovie);

module.exports = router;