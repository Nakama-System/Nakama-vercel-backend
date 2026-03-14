// ═══════════════════════════════════════════════════════════
// controllers/authController.js — Nakama | Lógica de Auth
// ═══════════════════════════════════════════════════════════

const jwt        = require("jsonwebtoken");
const User       = require("../models/User");
const { uploadToCloudinary, trimVideoAndUpload } = require("../services/cloudinaryService");

const JWT_SECRET            = process.env.JWT_SECRET            || "nakama_jwt_dev";
const JWT_REFRESH_SECRET    = process.env.JWT_REFRESH_SECRET    || "nakama_refresh_dev";
const JWT_ONBOARDING_SECRET = process.env.JWT_ONBOARDING_SECRET || "nakama_onboarding_dev";

function signAccessToken(userId, role) {
  return jwt.sign({ id: userId, role }, JWT_SECRET, { expiresIn: "15m" });
}
function signRefreshToken(userId) {
  return jwt.sign({ id: userId }, JWT_REFRESH_SECRET, { expiresIn: "30d" });
}
function signOnboardingToken(userId) {
  return jwt.sign({ id: userId, purpose: "onboarding" }, JWT_ONBOARDING_SECRET, { expiresIn: "30m" });
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
    id:                      user._id,
    username:                user.username,
    email:                   user.email,
    role:                    user.role,
    avatarUrl:               user.avatarUrl,
    profileVideo:            user.profileVideo,
    interests:               user.interests,
    bio:                     user.bio,
    displayName:             user.displayName,
    rank:                    user.rank,
    followersCount:          user.followersCount,
    followingCount:          user.followingCount,
    isOnline:                user.isOnline,
    subscription:            user.subscription,
    acceptedTermsVersion:    user.acceptedTermsVersion,
    acceptedPrivacyVersion:  user.acceptedPrivacyVersion,
    pendingTermsAcceptance:  user.pendingTermsAcceptance,
    monthlyVideoLimit:       user.monthlyVideoLimit,
    monthlyVideoRemaining:   user.monthlyVideoRemaining,
    canCreateComunidad:      user.canCreateComunidad,
    canToggleRoomVisibility: user.canToggleRoomVisibility,
    onboardingComplete:      user.onboardingComplete,
    createdAt:               user.createdAt,
    // ── Stats de batalla ──
    victorias:               user.victorias ?? 0,
    derrotas:                user.derrotas  ?? 0,
    empates:                 user.empates   ?? 0,
  };
}

// ─── Default legalConsent para registros simples ──────────
function buildDefaultLegalConsent(ip = "unknown") {
  return {
    termsVersion:    "1.0",
    privacyVersion:  "1.0",
    consentIp:       ip,
    consentTs:       new Date(),
    userAgent:       "",
    parentalConsent: false,
  };
}

// ═══════════════════════════════════════════════════════════
// REGISTER (email/password)
// ═══════════════════════════════════════════════════════════
exports.register = async (req, res) => {
  try {
    const { username, email, password, avatarMode = "default", trimStart = 0 } = req.body;

    if (!username || !email || !password) {
      return res.status(400).json({ success: false, message: "Completá todos los campos obligatorios." });
    }
    if (password.length < 8) {
      return res.status(400).json({ success: false, message: "La contraseña debe tener al menos 8 caracteres." });
    }

    const existing = await User.findOne({ $or: [{ email }, { username }] });
    if (existing) {
      const field = existing.email === email ? "email" : "nombre de usuario";
      return res.status(409).json({ success: false, message: `El ${field} ya está en uso.` });
    }

    let avatarUrl = "", avatarPublicId = "", profileVideo;

    if (req.file && avatarMode !== "default") {
      const mimeType = req.file.mimetype;
      const isVideo  = mimeType.startsWith("video/");
      const isGif    = mimeType === "image/gif";
      if (isVideo) {
        const result = await trimVideoAndUpload(req.file.buffer, {
          folder: "nakama/profile_videos",
          trimStart: Number(trimStart), trimEnd: Number(trimStart) + 6,
        });
        profileVideo   = { url: result.fullUrl, publicId: result.fullPublicId, thumbnailUrl: result.thumbnailUrl, duration: 6 };
        avatarUrl      = result.thumbnailUrl || result.fullUrl;
        avatarPublicId = result.fullPublicId;
      } else {
        const result = await uploadToCloudinary(req.file.buffer, {
          folder: "nakama/avatars",
          resourceType: "image",
          transformation: [{ width: 400, height: 400, crop: "fill", gravity: "face" }],
        });
        avatarUrl      = result.secure_url;
        avatarPublicId = result.public_id;
      }
    }

    // ── FIX: legalConsent es required en el schema, siempre lo populamos ──
    const clientIp = req.headers["x-forwarded-for"]?.split(",")[0] || req.socket?.remoteAddress || "unknown";

    const user = await User.create({
      username, email, password, role: "user",
      avatarUrl, avatarPublicId, profileVideo,
      onboardingComplete: true,
      legalConsent: buildDefaultLegalConsent(clientIp),
    });

    if (profileVideo) { user.registerVideoUpload?.(); await user.save(); }

    const accessToken  = signAccessToken(user._id, user.role);
    const refreshToken = signRefreshToken(user._id);
    setRefreshCookie(res, refreshToken);

    return res.status(201).json({ success: true, message: "Cuenta creada. ¡Bienvenido a Nakama!", token: accessToken, user: formatUser(user) });
  } catch (err) {
    console.error("[register]", err);
    return res.status(500).json({ success: false, message: "Error interno al registrar usuario." });
  }
};

// ═══════════════════════════════════════════════════════════
// LOGIN  — FIX: usamos updateOne para evitar validación completa
// ═══════════════════════════════════════════════════════════
exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ success: false, message: "Email y contraseña son obligatorios." });
    }

    const user = await User.findOne({ email }).select("+password");
    if (!user) return res.status(401).json({ success: false, message: "Credenciales inválidas." });
    if (user.isBanned) return res.status(403).json({ success: false, message: `Cuenta suspendida: ${user.banReason || "infracción de normas"}` });

    const valid = await user.comparePassword(password);
    if (!valid) return res.status(401).json({ success: false, message: "Credenciales inválidas." });

    // ── FIX: usamos updateOne para no disparar validaciones del schema completo ──
    await User.updateOne(
      { _id: user._id },
      { $set: { lastSeenAt: new Date(), isOnline: true } }
    );

    const accessToken  = signAccessToken(user._id, user.role);
    const refreshToken = signRefreshToken(user._id);
    setRefreshCookie(res, refreshToken);

    return res.json({ success: true, message: "Sesión iniciada.", token: accessToken, user: formatUser(user) });
  } catch (err) {
    console.error("[login]", err);
    return res.status(500).json({ success: false, message: "Error interno al iniciar sesión." });
  }
};

// ═══════════════════════════════════════════════════════════
// LOGOUT
// ═══════════════════════════════════════════════════════════
exports.logout = async (req, res) => {
  try {
    if (req.user) {
      await User.updateOne(
        { _id: req.user.id },
        { $set: { isOnline: false, lastSeenAt: new Date() } }
      );
    }
    res.clearCookie("nakama_refresh");
    return res.json({ success: true, message: "Sesión cerrada." });
  } catch (err) {
    console.error("[logout]", err);
    return res.status(500).json({ success: false, message: "Error al cerrar sesión." });
  }
};

// ═══════════════════════════════════════════════════════════
// GET ME
// ═══════════════════════════════════════════════════════════
exports.getMe = async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ success: false, message: "Usuario no encontrado." });
    return res.json({ success: true, user: formatUser(user) });
  } catch (err) {
    console.error("[getMe]", err);
    return res.status(500).json({ success: false, message: "Error al obtener usuario." });
  }
};

// ═══════════════════════════════════════════════════════════
// REFRESH TOKEN
// ═══════════════════════════════════════════════════════════
exports.refreshToken = async (req, res) => {
  try {
    const token = req.cookies?.nakama_refresh;
    if (!token) return res.status(401).json({ success: false, message: "No hay refresh token." });

    let payload;
    try { payload = jwt.verify(token, JWT_REFRESH_SECRET); }
    catch { return res.status(401).json({ success: false, message: "Refresh token inválido o expirado." }); }

    const user = await User.findById(payload.id);
    if (!user || !user.isActive) return res.status(401).json({ success: false, message: "Usuario no encontrado." });

    return res.json({ success: true, token: signAccessToken(user._id, user.role) });
  } catch (err) {
    console.error("[refreshToken]", err);
    return res.status(500).json({ success: false, message: "Error al renovar token." });
  }
};

// ═══════════════════════════════════════════════════════════
// GOOGLE CALLBACK
// ═══════════════════════════════════════════════════════════
exports.googleCallback = async (req, res) => {
  try {
    const { user, isNewGoogleUser } = req.user || {};
    if (!user) return res.redirect(`${process.env.CLIENT_URL}/login?error=google_failed`);

    if (!isNewGoogleUser && user.onboardingComplete) {
      const accessToken  = signAccessToken(user._id, user.role);
      const refreshToken = signRefreshToken(user._id);
      setRefreshCookie(res, refreshToken);
      return res.redirect(`${process.env.CLIENT_URL}/auth/callback?token=${accessToken}`);
    }

    const onboardingToken = signOnboardingToken(user._id);
    return res.redirect(
      `${process.env.CLIENT_URL}/registro/google` +
      `?ot=${onboardingToken}` +
      `&email=${encodeURIComponent(user.email)}` +
      `&username=${encodeURIComponent(user.username)}`
    );
  } catch (err) {
    console.error("[googleCallback]", err);
    return res.redirect(`${process.env.CLIENT_URL}/login?error=server`);
  }
};

// ═══════════════════════════════════════════════════════════
// COMPLETAR ONBOARDING GOOGLE
// ═══════════════════════════════════════════════════════════
exports.completeGoogleOnboarding = async (req, res) => {
  try {
    const {
      onboardingToken, birthDate, consentIp, consentTs,
      userAgent, parentalConsent, username,
      termsVersion = "1.0", privacyVersion = "1.0",
      avatarMode = "default", trimStart = 0,
    } = req.body;

    if (!onboardingToken) {
      return res.status(401).json({ success: false, message: "Token de onboarding requerido." });
    }

    let payload;
    try { payload = jwt.verify(onboardingToken, JWT_ONBOARDING_SECRET); }
    catch {
      return res.status(401).json({
        success: false,
        message: "Token expirado. Por favor volvé a iniciar sesión con Google.",
      });
    }

    if (payload.purpose !== "onboarding") {
      return res.status(401).json({ success: false, message: "Token inválido." });
    }

    const user = await User.findById(payload.id);
    if (!user) return res.status(404).json({ success: false, message: "Usuario no encontrado." });

    if (user.onboardingComplete) {
      const accessToken  = signAccessToken(user._id, user.role);
      const refreshToken = signRefreshToken(user._id);
      setRefreshCookie(res, refreshToken);
      return res.json({ success: true, token: accessToken, user: formatUser(user) });
    }

    if (!birthDate || !consentTs) {
      return res.status(400).json({ success: false, message: "Faltan datos del consentimiento legal." });
    }

    let avatarUrl      = user.avatarUrl || "";
    let avatarPublicId = user.avatarPublicId || "";
    let profileVideo;

    if (req.file && avatarMode !== "default") {
      const mimeType = req.file.mimetype;
      const isVideo  = mimeType.startsWith("video/");
      if (isVideo) {
        const result = await trimVideoAndUpload(req.file.buffer, {
          folder: "nakama/profile_videos",
          trimStart: Number(trimStart), trimEnd: Number(trimStart) + 6,
        });
        profileVideo   = { url: result.fullUrl, publicId: result.fullPublicId, thumbnailUrl: result.thumbnailUrl, duration: 6 };
        avatarUrl      = result.thumbnailUrl || result.fullUrl;
        avatarPublicId = result.fullPublicId;
      } else {
        const result = await uploadToCloudinary(req.file.buffer, {
          folder: "nakama/avatars",
          resourceType: "image",
          transformation: [{ width: 400, height: 400, crop: "fill", gravity: "face" }],
        });
        avatarUrl      = result.secure_url;
        avatarPublicId = result.public_id;
      }
    }

    if (username && username.trim().length >= 3) {
      const taken = await User.findOne({ username: username.trim(), _id: { $ne: user._id } });
      if (!taken) user.username = username.trim();
    }

    user.birthDate          = new Date(birthDate);
    user.termsAccepted      = true;
    user.privacyAccepted    = true;
    user.antiGroomingAck    = true;
    user.parentalConsent    = parentalConsent === "true" || parentalConsent === true;
    user.consentIp          = consentIp   || "unknown";
    user.consentTimestamp   = new Date(consentTs);
    user.consentUserAgent   = userAgent   || "";
    user.termsVersion       = termsVersion;
    user.privacyVersion     = privacyVersion;
    user.onboardingComplete = true;
    user.isActive           = true;
    user.avatarUrl          = avatarUrl;
    user.avatarPublicId     = avatarPublicId;
    if (profileVideo) { user.profileVideo = profileVideo; user.registerVideoUpload?.(); }

    // Asegurar legalConsent si falta
    if (!user.legalConsent) {
      user.legalConsent = {
        termsVersion, privacyVersion,
        consentIp: consentIp || "unknown",
        consentTs: new Date(consentTs),
        userAgent: userAgent || "",
        parentalConsent: parentalConsent === "true" || parentalConsent === true,
      };
    }

    await user.save();

    const accessToken  = signAccessToken(user._id, user.role);
    const refreshToken = signRefreshToken(user._id);
    setRefreshCookie(res, refreshToken);

    return res.status(200).json({ success: true, message: "¡Bienvenido a Nakama!", token: accessToken, user: formatUser(user) });
  } catch (err) {
    console.error("[completeGoogleOnboarding]", err);
    return res.status(500).json({ success: false, message: "Error al completar el registro." });
  }
};