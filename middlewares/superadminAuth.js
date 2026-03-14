// ═══════════════════════════════════════════════════════════
// middleware/superadminAuth.js
// ═══════════════════════════════════════════════════════════
const jwt = require("jsonwebtoken");

exports.superadminAuth = (req, res, next) => {
  try {
    const header = req.headers.authorization || "";
    const token  = header.startsWith("Bearer ") ? header.slice(7) : null;
    if (!token) return res.status(401).json({ ok: false, message: "Sin token" });

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (decoded.role !== "superadmin") {
      return res.status(403).json({ ok: false, message: "Acceso denegado" });
    }
    req.user = decoded;
    next();
  } catch {
    return res.status(401).json({ ok: false, message: "Token inválido" });
  }
};