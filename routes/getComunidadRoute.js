// ═══════════════════════════════════════════════════════════
// routes/getComunidadRoute.js
// ═══════════════════════════════════════════════════════════

const express    = require("express");
const router     = express.Router();
const { optionalAuth } = require("../middlewares/optionalAuth");
const {
  getComunidades,
  getComunidadById,
} = require("../controllers/getComunidadController");

// GET /comunidades          — lista pública (con info de membresía si hay token)
router.get("/",          optionalAuth, getComunidades);

// GET /comunidades/:id      — detalle público de una comunidad
router.get("/:id",       optionalAuth, getComunidadById);

module.exports = router;