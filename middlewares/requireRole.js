// ═══════════════════════════════════════════════════════════
// middleware/requireRole.js — Nakama
// Middleware de autorización por rol + verificación de ban/suspend
// ═══════════════════════════════════════════════════════════

const jwt  = require("jsonwebtoken");
const User = require("../models/User");

const JWT_SECRET = process.env.JWT_SECRET || "nakama_jwt_dev";

// Jerarquía de roles (mayor índice = más permisos)
const ROLE_HIERARCHY = {
  "user":        0,
  "user-pro":    1,
  "user-premium":2,
  "moderator":   3,
  "admin":       4,
  "superadmin":  5,
};

// ─── Middleware: autenticar con JWT ───────────────────────
exports.authenticate = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader?.startsWith("Bearer ")
      ? authHeader.slice(7)
      : req.cookies?.nakama_token;

    if (!token) {
      return res.status(401).json({ success: false, message: "No autenticado." });
    }

    const decoded = jwt.verify(token, JWT_SECRET);
    const user    = await User.findById(decoded.id).select(
      "+password username email role isBanned isSuspended suspendUntil " +
      "pendingTermsAcceptance acceptedTermsVersion legalConsent"
    );

    if (!user || !user.isActive) {
      return res.status(401).json({ success: false, message: "Usuario no encontrado o inactivo." });
    }

    // ── Verificar ban ──────────────────────────────────────
    if (user.isBanned) {
      return res.status(403).json({
        success:   false,
        code:      "ACCOUNT_BANNED",
        message:   "Tu cuenta fue suspendida permanentemente.",
        reason:    user.banReason,
      });
    }

    // ── Verificar suspensión activa ───────────────────────
    if (user.isSuspended) {
      const until = user.suspendUntil;
      if (!until || new Date() < until) {
        return res.status(403).json({
          success: false,
          code:    "ACCOUNT_SUSPENDED",
          message: `Tu cuenta está suspendida${until ? ` hasta el ${until.toLocaleDateString("es-AR")}` : " indefinidamente"}.`,
          reason:  user.suspendReason,
          until:   until,
        });
      }
      // Si la suspensión temporal expiró, levantarla automáticamente
      user.isSuspended = false;
      user.suspendUntil = null;
      await user.save();
    }

    req.user = user;
    next();
  } catch (err) {
    if (err.name === "TokenExpiredError") {
      return res.status(401).json({ success: false, code: "TOKEN_EXPIRED", message: "La sesión expiró." });
    }
    return res.status(401).json({ success: false, message: "Token inválido." });
  }
};

// ─── Middleware: requerir rol mínimo ──────────────────────
exports.requireRole = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ success: false, message: "No autenticado." });
    }

    const userLevel    = ROLE_HIERARCHY[req.user.role] ?? -1;
    const minRequired  = Math.min(...roles.map(r => ROLE_HIERARCHY[r] ?? 99));

    if (userLevel < minRequired) {
      return res.status(403).json({
        success: false,
        message: `Se requiere rol: ${roles.join(" o ")}.`,
      });
    }
    next();
  };
};

// ─── Atajo: solo superadmin ───────────────────────────────
exports.superadminOnly = (req, res, next) => {
  if (!req.user || req.user.role !== "superadmin") {
    return res.status(403).json({ success: false, message: "Acceso exclusivo del superadmin." });
  }
  next();
};

// ─── Atajo: moderador o superior ─────────────────────────
exports.moderatorOrAbove = exports.requireRole("moderator", "admin", "superadmin");

// ─── Atajo: admin o superior ──────────────────────────────
exports.adminOrAbove = exports.requireRole("admin", "superadmin");