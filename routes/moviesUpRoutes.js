// ═══════════════════════════════════════════════════════════
// routes/movieRoutes.js — Nakama | Movies CRUD
// Usar así en app.js:  app.use("/api/movies", movieRoutes);
// ═══════════════════════════════════════════════════════════

const express = require("express");
const router  = express.Router();
const { protect, requireRole } = require("../middlewares/authMiddleware");
const ctrl = require("../controllers/peliController");

// Rutas públicas (o con usuario opcional)
router.get("/",    ctrl.getMovies);
router.get("/:id", ctrl.getMovieById);
router.get("/:id/share", ctrl.getShareMeta);

// Rutas autenticadas
router.post("/:id/vote",     protect, ctrl.voteMovie);
router.post("/:id/download", protect, ctrl.downloadMovie);

// Rutas de admin (solo superadmin)
router.post(  "/",    protect, requireRole("superadmin", "admin"), ctrl.createMovie);
router.put(   "/:id", protect, requireRole("superadmin", "admin"), ctrl.updateMovie);
router.delete("/:id", protect, requireRole("superadmin"),          ctrl.deleteMovie);

module.exports = router;