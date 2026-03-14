// ═══════════════════════════════════════════════════════════
// routes/registerRoutes.js — Nakama | Rutas de Registro
// ═══════════════════════════════════════════════════════════

const express = require("express");
const multer  = require("multer");
const {
  initiateRegister,
  verifyRegisterCode,
  resendCode,
  completeRegister,
} = require("../controllers/registerController");

const router = express.Router();

// ─── Multer para el paso 3 (avatar/video) ────────────────
const upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 50 * 1024 * 1024 }, // 50 MB
  fileFilter(_req, file, cb) {
    const allowed = [
      "image/jpeg", "image/png", "image/webp", "image/gif",
      "video/mp4", "video/webm", "video/quicktime",
    ];
    allowed.includes(file.mimetype)
      ? cb(null, true)
      : cb(new Error("Tipo de archivo no permitido."), false);
  },
});

// ─── PASO 1: iniciar registro ─────────────────────────────
// POST /register/initiate
// Body JSON: { username, email, password }
// Crea PendingUser y envía código por email
router.post("/initiate", initiateRegister);

// ─── PASO 2: verificar código (OBLIGATORIO) ───────────────
// POST /register/verify
// Body JSON: { pendingUserId, code }
// Sin pasar por aquí no se puede completar el registro
router.post("/verify", verifyRegisterCode);

// ─── REENVÍO de código ────────────────────────────────────
// POST /register/resend-code
// Body JSON: { pendingUserId }
router.post("/resend-code", resendCode);

// ─── PASO 3: completar registro con avatar ────────────────
// POST /register/complete
// Body multipart: { pendingUserId, avatarMode, avatar?, trimStart? }
router.post("/complete", upload.single("avatar"), completeRegister);

module.exports = router;