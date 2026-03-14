// ═══════════════════════════════════════════════════════════
// routes/passwordRoutes.js — Nakama | Rutas de reset de contraseña
// ═══════════════════════════════════════════════════════════

const express = require("express");
const { forgotPassword, resetPassword } = require("../controllers/passwordController");

const router = express.Router();

// POST /auth/forgot-password  → envía email con enlace
router.post("/forgot-password", forgotPassword);

// POST /auth/reset-password   → cambia la contraseña con el token
router.post("/reset-password",  resetPassword);

module.exports = router;