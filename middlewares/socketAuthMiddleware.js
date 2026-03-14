// ═══════════════════════════════════════════════════════════
// middlewares/socketAuthMiddleware.js — Socket.io Auth
// Basado en tu authMiddleware.js pero para Socket.io
// ═══════════════════════════════════════════════════════════

const jwt = require("jsonwebtoken");
const User = require("../models/User");

const JWT_SECRET = process.env.JWT_SECRET || "nakama_jwt_dev";

/**
 * Middleware de autenticación para Socket.io
 * Verifica el JWT y adjunta el usuario al socket
 */
const socketAuthMiddleware = async (socket, next) => {
  try {
    // 1️⃣ Obtener el token del handshake (enviado por el cliente)
    const token = socket.handshake.auth.token;

    // 2️⃣ Validar que el token existe
    if (!token) {
      console.warn(`[socket] Sin token en handshake para socket ${socket.id}`);
      return next(new Error("No se proporcionó token de autenticación"));
    }

    // 3️⃣ Verificar el JWT (igual a tu authMiddleware.js)
    let decoded;
    try {
      decoded = jwt.verify(token, JWT_SECRET);
    } catch (err) {
      console.warn(`[socket] Token inválido: ${err.message}`);
      if (err.name === "TokenExpiredError") {
        return next(new Error("Sesión expirada"));
      }
      return next(new Error("Token inválido"));
    }

    // 4️⃣ Obtener el usuario de la BD (igual a tu authMiddleware.js)
    const user = await User.findById(decoded.id);

    if (!user) {
      console.warn(`[socket] Usuario no encontrado: ${decoded.id}`);
      return next(new Error("Usuario no encontrado"));
    }

    if (!user.isActive) {
      console.warn(`[socket] Usuario inactivo: ${user.username}`);
      return next(new Error("Usuario desactivado"));
    }

    if (user.isBanned) {
      console.warn(`[socket] Usuario baneado: ${user.username}`);
      return next(new Error(`Cuenta suspendida: ${user.banReason}`));
    }

    // ✅ 5️⃣ LO IMPORTANTE: Setear socket.user (igual a req.user en HTTP)
    socket.user = {
      _id: user._id,
      id: user._id,
      username: user.username,
      email: user.email,
      role: user.role,
    };

    console.log(`✅ [socket] Usuario autenticado: ${user.username} (${socket.id})`);

    // 6️⃣ Continuar con la conexión
    next();
  } catch (err) {
    console.error("[socket] Error en middleware de auth:", err.message);
    next(new Error("Error en autenticación de socket"));
  }
};

module.exports = socketAuthMiddleware;