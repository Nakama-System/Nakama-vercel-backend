// ═══════════════════════════════════════════════════════════
// models/PendingUser.js — Nakama
// Registro en dos pasos: este documento vive solo hasta que
// el usuario completa la verificación de email.
// TTL index: se elimina automáticamente a las 24 hs si no
// se completa el registro.
// ═══════════════════════════════════════════════════════════

const mongoose  = require("mongoose");
const bcrypt    = require("bcryptjs");

const pendingUserSchema = new mongoose.Schema({
  username: { type: String, required: true, trim: true },
  email:    { type: String, required: true, lowercase: true, trim: true },
  password: { type: String, required: true }, // hasheado en pre-save

  // ── Código de verificación ────────────────────────────
  verificationCode: { type: String, required: true }, // hasheado en pre-save
  codeExpiresAt:    { type: Date,   required: true },
  failedAttempts:   { type: Number, default: 0 },

  // ── Reenvíos ──────────────────────────────────────────
  resendCount:   { type: Number, default: 0 },
  lastResendAt:  { type: Date },

  // ── Consentimiento legal (capturado en paso 0) ─────────
  legalConsent: {
    birthDate:       { type: Date },
    consentIp:       { type: String },
    consentTs:       { type: Date },
    userAgent:       { type: String },
    parentalConsent: { type: Boolean, default: false },
    termsVersion:    { type: String, default: "1.0" },
    privacyVersion:  { type: String, default: "1.0" },
  },

  // ── TTL: se autodestruye si no se completa en 24 hs ───
  createdAt: { type: Date, default: Date.now, expires: 86400 }, // 24 hs
});

// ─── Pre-save: hashear password y código ──────────────────
pendingUserSchema.pre("save", async function (next) {
  if (this.isModified("password") && this.password) {
    if (!this.password.startsWith("$2b$") && !this.password.startsWith("$2a$")) {
      this.password = await bcrypt.hash(this.password, 12);
    }
  }
  if (this.isModified("verificationCode") && this.verificationCode) {
    // No hashear si ya es hash bcrypt o "USED"
    if (
      !this.verificationCode.startsWith("$2b$") &&
      !this.verificationCode.startsWith("$2a$") &&
      this.verificationCode !== "USED"
    ) {
      this.verificationCode = await bcrypt.hash(this.verificationCode, 10);
    }
  }
  next();
});

// ─── Métodos ──────────────────────────────────────────────
pendingUserSchema.methods.isCodeExpired = function () {
  return new Date() > this.codeExpiresAt;
};

pendingUserSchema.methods.verifyCode = async function (plainCode) {
  if (this.verificationCode === "USED") return false;
  return bcrypt.compare(String(plainCode).trim(), this.verificationCode);
};

// Controla cooldown y límite de reenvíos
pendingUserSchema.methods.canResend = function () {
  const MAX_RESENDS  = 5;
  const COOLDOWN_SEC = 60;

  if (this.resendCount >= MAX_RESENDS) {
    return { ok: false, reason: "Alcanzaste el límite de reenvíos. Por favor registrate de nuevo." };
  }
  if (this.lastResendAt) {
    const secSince = (Date.now() - this.lastResendAt.getTime()) / 1000;
    if (secSince < COOLDOWN_SEC) {
      const remaining = Math.ceil(COOLDOWN_SEC - secSince);
      return { ok: false, reason: `Esperá ${remaining} segundos antes de reenviar.` };
    }
  }
  return { ok: true };
};

const PendingUser = mongoose.model("PendingUser", pendingUserSchema);
module.exports = PendingUser;