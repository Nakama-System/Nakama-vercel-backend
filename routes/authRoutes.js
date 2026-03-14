// ═══════════════════════════════════════════════════════════
// routes/authRoutes.js — Nakama | Rutas de autenticación
// ═══════════════════════════════════════════════════════════

const express  = require("express");
const passport = require("passport");
const multer   = require("multer");
const crypto   = require("crypto");
const jwt      = require("jsonwebtoken");

const {
  register, login, logout, getMe,
  googleCallback, refreshToken, completeGoogleOnboarding,
} = require("../controllers/authController");

const { forgotPassword, resetPassword } = require("../controllers/passwordController");


const { protect }    = require("../middlewares/authMiddleware");
const PreConsent     = require("../models/PreConsent");
const User           = require("../models/User");

const router     = express.Router();
const CLIENT_URL = process.env.CLIENT_URL || "http://localhost:3000";
const JWT_SECRET = process.env.JWT_SECRET || "nakama_jwt_dev";

const upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 50 * 1024 * 1024 },
  fileFilter(_req, file, cb) {
    const allowed = [
      "image/jpeg", "image/png", "image/webp", "image/gif",
      "video/mp4",  "video/webm", "video/quicktime",
    ];
    cb(allowed.includes(file.mimetype) ? null : new Error("Tipo de archivo no permitido"),
       allowed.includes(file.mimetype));
  },
});



// ── Email / password ───────────────────────────────────────
router.post("/register",  upload.single("avatar"), register);
router.post("/login",     login);
router.post("/forgot-password", forgotPassword);  // ← envía el email
router.post("/reset-password",  resetPassword);   // ← cambia la contraseña con el token
router.post("/logout",    protect, logout);
router.get("/me",         protect, getMe);
router.post("/refresh",   refreshToken);

// ── Pre-consent ────────────────────────────────────────────
router.post("/pre-consent", async (req, res) => {
  try {
    const {
      birthDate, parentalConsent, termsAccepted, privacyAccepted,
      antiGroomingAck, consentTimestamp, consentIp, userAgent,
      termsVersion, privacyVersion,
    } = req.body;

    if (!birthDate || !termsAccepted || !privacyAccepted || !antiGroomingAck) {
      return res.status(400).json({ message: "Faltan campos obligatorios de consentimiento." });
    }

    const preConsent = await PreConsent.create({
      birthDate, parentalConsent: parentalConsent ?? false,
      termsAccepted, privacyAccepted, antiGroomingAck,
      consentTimestamp: consentTimestamp || new Date().toISOString(),
      consentIp:   consentIp  || "unknown",
      userAgent:   userAgent  || "",
      termsVersion:   termsVersion   || "1.0",
      privacyVersion: privacyVersion || "1.0",
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
    });

    res.json({ preConsentToken: preConsent._id.toString() });
  } catch (err) {
    console.error("[pre-consent]", err);
    res.status(500).json({ message: "Error al guardar el consentimiento." });
  }
});

// ── Google OAuth: iniciar ──────────────────────────────────
router.get("/google",
  passport.authenticate("google", {
    scope:  ["profile", "email"],
    prompt: "select_account",
  }),
);

// ── Google OAuth: callback ─────────────────────────────────
router.get("/google/callback",
  passport.authenticate("google", {
    failureRedirect: `https://nakama-front.vercel.app/registro?error=consent_expired`,
    session: false,
  }),
  async (req, res) => {
    try {
      const { user, isNewGoogleUser } = req.user;

      // ── Usuario existente → login directo, volver a "/"
      if (!isNewGoogleUser) {
        const token = jwt.sign(
          { id: user._id, role: user.role },
          JWT_SECRET,
          { expiresIn: "7d" },
        );
        // Redirigir a / con el token en query param para que el frontend lo guarde
        return res.redirect(`${CLIENT_URL}/?token=${token}`);
      }

      // ── Usuario nuevo → onboarding (username + avatar)
      const onboardingToken = crypto.randomBytes(32).toString("hex");
      user.onboardingToken       = onboardingToken;
      user.onboardingTokenExpiry = new Date(Date.now() + 30 * 60 * 1000);
      await user.save();

      const params = new URLSearchParams({
        ot:       onboardingToken,
        email:    user.email,
        username: user.username,
      });

      return res.redirect(`https://nakama-front.vercel.app/registro/google?${params.toString()}`);
    } catch (err) {
      console.error("[google/callback]", err);
      return res.redirect(`https://nakama-front.vercel.app/registro?error=server_error`);
    }
  },
);

// ── Completar onboarding Google ────────────────────────────
router.post("/google/complete-onboarding", upload.single("avatar"), async (req, res) => {
  try {
    const { onboardingToken, username, avatarMode } = req.body;

    const user = await User.findOne({
      onboardingToken,
      onboardingTokenExpiry: { $gt: new Date() },
    });

    if (!user) {
      return res.status(401).json({ message: "Token expirado o inválido. Volvé a registrarte." });
    }

    const taken = await User.findOne({ username, _id: { $ne: user._id } });
    if (taken) {
      return res.status(409).json({ message: "Ese nombre de usuario ya está en uso." });
    }

    user.username = username;

    if (avatarMode !== "default" && req.file) {
      user.avatarUrl = `/uploads/${req.file.originalname}`;
    }

    user.onboardingComplete    = true;
    user.onboardingToken       = undefined;
    user.onboardingTokenExpiry = undefined;
    await user.save();

    const token = jwt.sign(
      { id: user._id, role: user.role },
      JWT_SECRET,
      { expiresIn: "7d" },
    );

    res.json({
      token,
      user: { id: user._id, username: user.username, email: user.email },
    });
  } catch (err) {
    console.error("[complete-onboarding]", err);
    res.status(500).json({ message: "Error interno del servidor." });
  }
});

module.exports = router;
