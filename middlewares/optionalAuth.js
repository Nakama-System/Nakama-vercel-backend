// ═══════════════════════════════════════════════════════════
// middleware/optionalAuth.js
// Adjunta req.user si el token es válido, pero NO bloquea
// la request si no hay token o es inválido.
// ═══════════════════════════════════════════════════════════

const jwt = require("jsonwebtoken");

exports.optionalAuth = (req, res, next) => {
  try {
    const header = req.headers.authorization || "";
    const token  = header.startsWith("Bearer ") ? header.slice(7) : null;
    if (token) {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      req.user = decoded; // { id, username, role, … }
    }
  } catch {
    // token inválido/expirado → ignorar, continuar como anónimo
  }
  next();
};