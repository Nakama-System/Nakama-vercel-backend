// ═══════════════════════════════════════════════════════════
// middlewares/authMiddleware.js — Nakama | JWT + Roles
// FIX: req.user ahora incluye tanto "id" como "_id"
//      para compatibilidad con battleController y otros
// ═══════════════════════════════════════════════════════════

const jwt  = require("jsonwebtoken");
const User = require("../models/User");

const JWT_SECRET = process.env.JWT_SECRET || "nakama_jwt_dev";

// ─── protect: verifica JWT ────────────────────────────────
exports.protect = async (req, res, next) => {
  try {
    let token;

    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith("Bearer ")) {
      token = authHeader.split(" ")[1];
    } else if (req.cookies?.nakama_token) {
      token = req.cookies.nakama_token;
    }

    if (!token) {
      return res.status(401).json({ success: false, message: "No autenticado. Por favor iniciá sesión." });
    }

    let decoded;
    try {
      decoded = jwt.verify(token, JWT_SECRET);
    } catch (err) {
      if (err.name === "TokenExpiredError") {
        return res.status(401).json({ success: false, message: "Sesión expirada. Por favor iniciá sesión nuevamente.", code: "TOKEN_EXPIRED" });
      }
      return res.status(401).json({ success: false, message: "Token inválido." });
    }

    const user = await User.findById(decoded.id);
    if (!user || !user.isActive) {
      return res.status(401).json({ success: false, message: "Usuario no encontrado o desactivado." });
    }
    if (user.isBanned) {
      return res.status(403).json({ success: false, message: `Cuenta suspendida: ${user.banReason}` });
    }

    // FIX: exponer tanto "id" como "_id" para compatibilidad total
    req.user = {
      id:       user._id,   // string-like (ObjectId)
      _id:      user._id,   // ← agregado: battleController y otros usan _id
      role:     user.role,
      username: user.username,
    };

    next();
  } catch (err) {
    console.error("[protect]", err);
    return res.status(500).json({ success: false, message: "Error de autenticación." });
  }
};

// ─── requireRole: verifica uno o más roles ────────────────
exports.requireRole = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ success: false, message: "No autenticado." });
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: `Esta acción requiere el rol: ${roles.join(" o ")}.`,
      });
    }
    next();
  };
};

// ─── requirePremium ───────────────────────────────────────
exports.requirePremium = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ success: false, message: "No autenticado." });
  }
  const allowed = ["user-premium", "superadmin"];
  if (!allowed.includes(req.user.role)) {
    return res.status(403).json({
      success: false,
      message: "Esta función está disponible solo para usuarios Premium.",
    });
  }
  next();
};


exports.optionalAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) return next();
 
    const token = authHeader.split(" ")[1];
    if (!token) return next();
 
    // Usar el mismo JWT_SECRET que usa protect
    const jwt     = require("jsonwebtoken");
    const User    = require("../models/User");
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user    = await User.findById(decoded.id).select("-password");
    if (user) req.user = user;
  } catch {
    // Token inválido o expirado — simplemente continuamos sin usuario
  }
  next();
};