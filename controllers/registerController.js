// ═══════════════════════════════════════════════════════════
// controllers/registerController.js — Nakama
// Registro en 3 pasos + consentimiento legal completo
// ═══════════════════════════════════════════════════════════

const crypto       = require("crypto");
const jwt          = require("jsonwebtoken");
const User         = require("../models/User");
const PendingUser  = require("../models/PendingUser");
const TermsVersion = require("../models/TermsVersion");
const { sendVerificationEmail } = require("../services/emailService");
const {
  uploadToCloudinary,
  trimVideoAndUpload,
} = require("../services/cloudinaryService");

const JWT_SECRET         = process.env.JWT_SECRET         || "nakama_jwt_dev";
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || "nakama_refresh_dev";

// ─── Helpers ──────────────────────────────────────────────
function generateCode() {
  return String(crypto.randomInt(100000, 999999));
}

function signAccessToken(userId, role) {
  return jwt.sign({ id: userId, role }, JWT_SECRET, { expiresIn: "15m" });
}

function signRefreshToken(userId) {
  return jwt.sign({ id: userId }, JWT_REFRESH_SECRET, { expiresIn: "30d" });
}

function setRefreshCookie(res, token) {
  res.cookie("nakama_refresh", token, {
    httpOnly: true,
    secure:   process.env.NODE_ENV === "production",
    sameSite: "strict",
    maxAge:   30 * 24 * 60 * 60 * 1000,
  });
}

function formatUser(user) {
  return {
    id:                     user._id,
    username:               user.username,
    email:                  user.email,
    role:                   user.role,
    avatarUrl:              user.avatarUrl,
    profileVideo:           user.profileVideo,
    rank:                   user.rank,
    acceptedTermsVersion:   user.acceptedTermsVersion,
    acceptedPrivacyVersion: user.acceptedPrivacyVersion,
    pendingTermsAcceptance: user.pendingTermsAcceptance,
  };
}

function calcAge(birthDate) {
  if (!birthDate) return 0;
  const today = new Date();
  const birth = new Date(birthDate);
  let age = today.getFullYear() - birth.getFullYear();
  const m = today.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
  return age;
}

// ═══════════════════════════════════════════════════════════
// PASO 1 — Iniciar registro
// POST /register/initiate
// Body: { username, email, password, birthDate, consentIp,
//         consentTs, userAgent, parentalConsent,
//         termsVersion, privacyVersion }
// ═══════════════════════════════════════════════════════════
exports.initiateRegister = async (req, res) => {
  try {
    const {
      username, email, password,
      birthDate, consentIp, consentTs, userAgent,
      parentalConsent = false,
      termsVersion = "1.0",
      privacyVersion = "1.0",
    } = req.body;

    // ── Validaciones básicas ──────────────────────────────
    if (!username?.trim() || !email?.trim() || !password) {
      return res.status(400).json({ success: false, message: "Completá todos los campos." });
    }
    if (username.trim().length < 3) {
      return res.status(400).json({ success: false, message: "El nombre de usuario debe tener al menos 3 caracteres." });
    }
    if (!/^\S+@\S+\.\S+$/.test(email)) {
      return res.status(400).json({ success: false, message: "El email no es válido." });
    }
    if (password.length < 8) {
      return res.status(400).json({ success: false, message: "La contraseña debe tener al menos 8 caracteres." });
    }

    // ── Validar edad ──────────────────────────────────────
    if (!birthDate) {
      return res.status(400).json({ success: false, message: "La fecha de nacimiento es obligatoria." });
    }
    const age = calcAge(birthDate);
    if (age < 13) {
      return res.status(403).json({
        success: false,
        message: "Debes tener al menos 13 años para registrarte en Nakama.",
      });
    }
    if (age < 18 && !parentalConsent) {
      return res.status(403).json({
        success: false,
        message: "Los menores de 18 años requieren autorización de un adulto responsable.",
      });
    }

    // ── Verificar que no exista ya usuario ────────────────
    const existing = await User.findOne({
      $or: [{ email: email.toLowerCase() }, { username: username.trim() }],
    });
    if (existing) {
      const field = existing.email === email.toLowerCase() ? "email" : "nombre de usuario";
      return res.status(409).json({ success: false, message: `El ${field} ya está registrado.` });
    }

    // ── Eliminar PendingUser anterior para este email ─────
    await PendingUser.deleteOne({ email: email.toLowerCase() });

    // ── Obtener versión activa de T&C ─────────────────────
    const activeTerms = await TermsVersion.getActive();
    const tv = activeTerms?.termsVersion   || termsVersion;
    const pv = activeTerms?.privacyVersion || privacyVersion;

    // ── Crear PendingUser ─────────────────────────────────
    const code    = generateCode();
    const codeExp = new Date(Date.now() + 15 * 60 * 1000); // 15 min

    const pending = await PendingUser.create({
      username: username.trim(),
      email:    email.toLowerCase(),
      password,                      // el pre-save de PendingUser lo hashea
      verificationCode: code,
      codeExpiresAt:    codeExp,
      legalConsent: {
        birthDate:       birthDate ? new Date(birthDate) : null,
        consentIp:       consentIp || req.ip || "unknown",
        consentTs:       consentTs ? new Date(consentTs) : new Date(),
        userAgent:       userAgent || req.headers["user-agent"] || "",
        parentalConsent: Boolean(parentalConsent),
        termsVersion:    tv,
        privacyVersion:  pv,
      },
    });

    // ── Enviar email ──────────────────────────────────────
    await sendVerificationEmail(email, username.trim(), code);

    return res.status(201).json({
      success:       true,
      message:       "Te enviamos un código de verificación a tu email.",
      pendingUserId: pending._id,
      ...(process.env.NODE_ENV !== "production" && { _devCode: code }),
    });
  } catch (err) {
    console.error("[initiateRegister]", err);
    return res.status(500).json({ success: false, message: "Error al iniciar el registro." });
  }
};

// ═══════════════════════════════════════════════════════════
// PASO 2 — Verificar código
// POST /register/verify
// Body: { pendingUserId, code }
// ═══════════════════════════════════════════════════════════
exports.verifyRegisterCode = async (req, res) => {
  try {
    const { pendingUserId, code } = req.body;
    if (!pendingUserId || !code) {
      return res.status(400).json({ success: false, message: "Faltan datos." });
    }

    const pending = await PendingUser.findById(pendingUserId);
    if (!pending) {
      return res.status(404).json({
        success: false,
        message: "Solicitud de registro no encontrada o expirada. Por favor, registrate de nuevo.",
      });
    }

    if (pending.failedAttempts >= 5) {
      await PendingUser.deleteOne({ _id: pendingUserId });
      return res.status(429).json({
        success: false,
        message: "Demasiados intentos fallidos. Por favor, registrate de nuevo.",
      });
    }

    if (pending.isCodeExpired()) {
      return res.status(400).json({
        success: false,
        message: "El código expiró. Hacé clic en \"Reenviar código\" para obtener uno nuevo.",
      });
    }

    const isValid = await pending.verifyCode(code.trim());
    if (!isValid) {
      pending.failedAttempts += 1;
      await pending.save();
      const remaining = 5 - pending.failedAttempts;
      return res.status(400).json({
        success: false,
        message: `Código incorrecto. ${remaining > 0 ? `Te quedan ${remaining} intento(s).` : "Sin más intentos."}`,
      });
    }

    // ✅ Código correcto: marcar como verificado seteando codeExpiresAt a epoch
    // NO tocamos verificationCode con bcrypt.hash("USED") para evitar
    // que el pre-save lo re-hashee. Usamos updateOne directo.
    await PendingUser.updateOne(
      { _id: pendingUserId },
      {
        $set: {
          failedAttempts:   0,
          verificationCode: "VERIFIED",   // valor centinela sin hashear
          codeExpiresAt:    new Date(0),  // epoch = verificado
        },
      }
    );

    return res.json({
      success: true,
      message: "Email verificado. Podés completar tu registro.",
      pendingUserId: pending._id,
    });
  } catch (err) {
    console.error("[verifyRegisterCode]", err);
    return res.status(500).json({ success: false, message: "Error al verificar el código." });
  }
};

// ═══════════════════════════════════════════════════════════
// REENVÍO — POST /register/resend-code
// Body: { pendingUserId }
// ═══════════════════════════════════════════════════════════
exports.resendCode = async (req, res) => {
  try {
    const { pendingUserId } = req.body;
    if (!pendingUserId) {
      return res.status(400).json({ success: false, message: "Falta el ID de registro." });
    }

    const pending = await PendingUser.findById(pendingUserId);
    if (!pending) {
      return res.status(404).json({ success: false, message: "Solicitud no encontrada. Registrate de nuevo." });
    }

    const canResend = pending.canResend();
    if (!canResend.ok) {
      return res.status(429).json({ success: false, message: canResend.reason });
    }

    const newCode = generateCode();
    pending.verificationCode = newCode;   // pre-save de PendingUser lo hashea
    pending.codeExpiresAt    = new Date(Date.now() + 15 * 60 * 1000);
    pending.failedAttempts   = 0;
    pending.resendCount     += 1;
    pending.lastResendAt     = new Date();
    await pending.save();

    await sendVerificationEmail(pending.email, pending.username, newCode);

    return res.json({
      success: true,
      message: "Te enviamos un nuevo código.",
      ...(process.env.NODE_ENV !== "production" && { _devCode: newCode }),
    });
  } catch (err) {
    console.error("[resendCode]", err);
    return res.status(500).json({ success: false, message: "Error al reenviar el código." });
  }
};

// ═══════════════════════════════════════════════════════════
// PASO 3 — Completar registro con avatar
// POST /register/complete
// Body multipart: { pendingUserId, avatarMode, avatar?, trimStart? }
// ═══════════════════════════════════════════════════════════
exports.completeRegister = async (req, res) => {
  try {
    const { pendingUserId, avatarMode = "default", trimStart = 0 } = req.body;
    if (!pendingUserId) {
      return res.status(400).json({ success: false, message: "Falta el ID de registro." });
    }

    const pending = await PendingUser.findById(pendingUserId);
    if (!pending) {
      return res.status(404).json({ success: false, message: "Solicitud no encontrada o expirada." });
    }

    // ── Verificar que pasó el paso 2 ──────────────────────
    const codeWasVerified = pending.codeExpiresAt.getTime() === 0;
    if (!codeWasVerified) {
      return res.status(403).json({
        success: false,
        message: "Debés verificar tu email antes de completar el registro.",
      });
    }

    // ── Verificar duplicados de carrera ───────────────────
    const alreadyExists = await User.findOne({
      $or: [{ email: pending.email }, { username: pending.username }],
    });
    if (alreadyExists) {
      await PendingUser.deleteOne({ _id: pendingUserId });
      return res.status(409).json({ success: false, message: "Esta cuenta ya fue creada." });
    }

    // ── Obtener T&C activa ────────────────────────────────
    const activeTerms = await TermsVersion.getActive();
    const tv = activeTerms?.termsVersion   || pending.legalConsent?.termsVersion   || "1.0";
    const pv = activeTerms?.privacyVersion || pending.legalConsent?.privacyVersion || "1.0";

    // ── Procesar avatar/video ─────────────────────────────
    let avatarUrl      = "";
    let avatarPublicId = "";
    let profileVideo   = null;

    if (req.file && avatarMode !== "default") {
      const isVideo = req.file.mimetype.startsWith("video/");

      if (isVideo) {
        const result = await trimVideoAndUpload(req.file.buffer, {
          folder:    "nakama/profile_videos",
          trimStart: Number(trimStart),
          trimEnd:   Number(trimStart) + 6,
        });
        profileVideo = {
          url:          result.fullUrl,
          publicId:     result.fullPublicId,
          thumbnailUrl: result.thumbnailUrl,
          duration:     6,
          flagged:      false,
        };
        avatarUrl      = result.thumbnailUrl || result.fullUrl;
        avatarPublicId = result.fullPublicId;
      } else {
        const result = await uploadToCloudinary(req.file.buffer, {
          folder:         "nakama/avatars",
          resourceType:   "image",
          transformation: [{ width: 400, height: 400, crop: "fill", gravity: "face" }],
        });
        avatarUrl      = result.secure_url;
        avatarPublicId = result.public_id;
      }
    }

    // ── Construir el documento de User ────────────────────
    const now = new Date();
    const lc  = pending.legalConsent || {};

    const userData = {
      username:      pending.username,
      email:         pending.email,
      // pending.password ya viene hasheado por el pre-save de PendingUser.
      // El pre-save de User detecta el prefijo "$2b$" y NO lo vuelve a hashear.
      password:      pending.password,
      role:          "user",
      avatarUrl,
      avatarPublicId,
      profileVideo,

      birthDate: lc.birthDate || null,

      // Consentimiento legal completo
      legalConsent: {
        termsVersion:    tv,
        privacyVersion:  pv,
        consentIp:       lc.consentIp       || "unknown",
        consentTs:       lc.consentTs       || now,
        userAgent:       lc.userAgent       || "",
        parentalConsent: lc.parentalConsent || false,
        birthDate:       lc.birthDate       || null,
      },

      // Versiones aceptadas
      acceptedTermsVersion:   tv,
      acceptedPrivacyVersion: pv,
      pendingTermsAcceptance: false,

      // Historial inicial
      termsHistory: [{
        termsVersion:   tv,
        privacyVersion: pv,
        acceptedAt:     lc.consentTs || now,
        acceptedIp:     lc.consentIp || "unknown",
        acceptedUA:     lc.userAgent || "",
      }],

      isOnline:    true,
      isActive:    true,
      isBanned:    false,
      isSuspended: false,
      lastSeenAt:  now,

      videoMonthlyLog: {
        month: now.getMonth() + 1,
        year:  now.getFullYear(),
        count: profileVideo ? 1 : 0,
      },
    };

    // ── FIX: usar new User() + save() en lugar de collection.insertOne()
    // Esto permite que Mongoose aplique defaults, virtuals e índices
    // correctamente. El pre-save hook de User ve que password empieza
    // con "$2b$" y lo deja intacto → no hay doble-hash.
    const newUser = new User(userData);
    await newUser.save();

    // Incrementar contador de aceptación en TermsVersion
    if (activeTerms) {
      await TermsVersion.findByIdAndUpdate(activeTerms._id, { $inc: { acceptedCount: 1 } });
    }

    // ── Limpiar PendingUser ───────────────────────────────
    await PendingUser.deleteOne({ _id: pendingUserId });

    // ── Emitir tokens ─────────────────────────────────────
    const accessToken  = signAccessToken(newUser._id, newUser.role);
    const refreshToken = signRefreshToken(newUser._id);
    setRefreshCookie(res, refreshToken);

    return res.status(201).json({
      success: true,
      message: "¡Bienvenido a Nakama! Tu cuenta fue creada exitosamente.",
      token:   accessToken,
      user:    formatUser(newUser),
    });
  } catch (err) {
    console.error("[completeRegister]", err);
    return res.status(500).json({ success: false, message: "Error al completar el registro." });
  }
};