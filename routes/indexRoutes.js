// ═══════════════════════════════════════════════════════════
// routes/nx-control/index.js — Nakama Superadmin Router
// ═══════════════════════════════════════════════════════════

const express = require("express");
const router  = express.Router();
const jwt     = require("jsonwebtoken");
const bcrypt  = require("bcryptjs");
const User    = require("../models/User");
const { protect, requireRole } = require("../middlewares/authMiddleware");

const JWT_SECRET = "Todas las sesiones anteriores fueron invalidadas DFADFADFASDFASFLCVLKCZVLKZ";

// ─── Middleware: verifica sessionVersion ──────────────────
async function checkSessionVersion(req, res, next) {
  try {
    const token   = req.headers.authorization?.split(" ")[1] || req.cookies?.nakama_token;
    if (!token) return next();

    const payload = jwt.decode(token);
    if (payload?.sv === undefined) return next();

    const freshUser = await User.findById(req.user._id).select("sessionVersion").lean();
    if (!freshUser)
      return res.status(401).json({ ok: false, message: "Usuario no encontrado" });

    if (payload.sv !== freshUser.sessionVersion)
      return res.status(401).json({ ok: false, message: "Sesión invalidada. Volvé a iniciar sesión." });

    next();
  } catch (err) {
    return res.status(401).json({ ok: false, message: "Error verificando sesión" });
  }
}

// ═══════════════════════════════════════════════════════════
// POST /nx-control/reveal — Login superadmin
// body: { email, reveal }
// ═══════════════════════════════════════════════════════════
router.post("/reveal", async (req, res) => {
  try {
    const { email, reveal } = req.body;
    if (!email || !reveal)
      return res.status(400).json({ ok: false, message: "email y reveal requeridos" });

    const user = await User.findOne({ email: email.toLowerCase().trim() })
      .select("+reveal +password role sessionVersion isActive isBanned avatarUrl username");

    if (!user || user.role !== "superadmin")
      return res.status(403).json({ ok: false, message: "Credenciales inválidas" });

    if (!user.reveal)
      return res.status(403).json({ ok: false, message: "reveal key no configurada" });

    const valid = await bcrypt.compare(reveal, user.reveal);
    if (!valid)
      return res.status(403).json({ ok: false, message: "Credenciales inválidas" });

    const token = jwt.sign(
      { id: user._id, role: user.role, sv: user.sessionVersion },
      JWT_SECRET,
      { expiresIn: "8h" },
    );

    return res.json({
      ok: true,
      token,
      user: { id: user._id, email: user.email, username: user.username, avatarUrl: user.avatarUrl },
    });
  } catch (err) {
    return res.status(500).json({ ok: false, message: err.message });
  }
});

// ─── Auth global para todo lo que sigue ──────────────────
router.use(protect, requireRole("superadmin"), checkSessionVersion);

// ═══════════════════════════════════════════════════════════
// POST /nx-control/kick-sessions
// ═══════════════════════════════════════════════════════════
router.post("/kick-sessions", async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    user.sessionVersion = (user.sessionVersion || 0) + 1;
    await user.save();

    const newToken = jwt.sign(
      { id: user._id, role: user.role, sv: user.sessionVersion },
      JWT_SECRET,
      { expiresIn: "8h" },
    );

    return res.json({ ok: true, message: "Sesiones anteriores invalidadas", token: newToken });
  } catch (err) {
    return res.status(500).json({ ok: false, message: err.message });
  }
});

// ═══════════════════════════════════════════════════════════
// GET /nx-control/stats
// ═══════════════════════════════════════════════════════════
router.get("/stats", async (req, res) => {
  try {
    const { Block, Report } = require("../models/BlockReport");
    const ContentFlag       = require("../models/ContentFlag");
    const Community         = require("../models/Community");
    const Chat              = require("../models/Chat");

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [
      totalUsers, newUsersToday, totalCommunities,
      onlineUsers, frozenUsers, bannedUsers,
      pendingReports, pendingFlags, activeBattles, totalBlocks,
    ] = await Promise.all([
      User.countDocuments({ isActive: true }),
      User.countDocuments({ createdAt: { $gte: today } }),
      Community.countDocuments(),
      User.countDocuments({ isOnline: true }),
      User.countDocuments({ isSuspended: true }),
      User.countDocuments({ isBanned: true }),
      Report.countDocuments({ status: "pendiente" }),
      ContentFlag.countDocuments({ status: "pending" }),
      Chat.countDocuments({ type: "grupo", isActive: true }).catch(() => 0),
      Block.countDocuments(),
    ]);

    return res.json({
      ok: true,
      stats: {
        totalUsers, newUsersToday, totalCommunities,
        onlineUsers, frozenUsers, bannedUsers,
        pendingReports, pendingFlags, activeBattles, totalBlocks,
      },
    });
  } catch (err) {
    return res.status(500).json({ ok: false, message: err.message });
  }
});

// ═══════════════════════════════════════════════════════════
// NOTIFICACIONES MASIVAS
// Estas 3 rutas viven acá y no en usersRoutes porque operan
// sobre conjuntos de usuarios y son exclusivas del panel SA.
// ─────────────────────────────────────────────────────────
// Helper interno: empuja una notif al array del usuario en DB
// y emite por socket si está disponible.
// ─────────────────────────────────────────────────────────
async function pushNotif(io, userId, { title, message }) {
  const notif = { title: title || "Aviso del sistema", body: message, createdAt: new Date(), read: false };
  await User.findByIdAndUpdate(userId, {
    $push: { notifications: { $each: [notif], $position: 0, $slice: 100 } },
  });
  io?.to(`user:${String(userId)}`).emit("notification", notif);
}

// ─── POST /nx-control/users/notify-batch ──────────────────
// Envía a una lista explícita de IDs.
// body: { userIds: string[], message: string, title?: string }
router.post("/users/notify-batch", async (req, res) => {
  try {
    const { userIds, message, title } = req.body;

    if (!Array.isArray(userIds) || userIds.length === 0)
      return res.status(400).json({ ok: false, message: "userIds requerido (array no vacío)" });
    if (!message?.trim())
      return res.status(400).json({ ok: false, message: "message requerido" });
    if (userIds.length > 500)
      return res.status(400).json({ ok: false, message: "Máximo 500 usuarios por batch" });

    const io = req.app.get("io");
    await Promise.all(userIds.map((id) => pushNotif(io, id, { title, message })));

    return res.json({ ok: true, sent: userIds.length });
  } catch (err) {
    return res.status(500).json({ ok: false, message: err.message });
  }
});

// ─── POST /nx-control/users/notify-role ───────────────────
// Envía a todos los usuarios de un rol específico (o todos si role="all").
// body: { role: string, message: string, title?: string }
router.post("/users/notify-role", async (req, res) => {
  try {
    const { role, message, title } = req.body;

    if (!message?.trim())
      return res.status(400).json({ ok: false, message: "message requerido" });

    const filter = { isActive: true };
    if (role && role !== "all") filter.role = role;

    // Procesar en lotes de 200 para no saturar memoria
    const BATCH = 200;
    const io    = req.app.get("io");
    let   sent  = 0;
    let   skip  = 0;

    while (true) {
      const users = await User.find(filter).select("_id").skip(skip).limit(BATCH).lean();
      if (users.length === 0) break;
      await Promise.all(users.map((u) => pushNotif(io, u._id, { title, message })));
      sent += users.length;
      skip += BATCH;
      if (users.length < BATCH) break;
    }

    return res.json({ ok: true, sent, role: role || "all" });
  } catch (err) {
    return res.status(500).json({ ok: false, message: err.message });
  }
});

// ─── POST /nx-control/users/notify-all ────────────────────
// Envía a todos los usuarios activos. Alias de notify-role sin filtro.
// body: { message: string, title?: string }
router.post("/users/notify-all", async (req, res) => {
  try {
    const { message, title } = req.body;

    if (!message?.trim())
      return res.status(400).json({ ok: false, message: "message requerido" });

    const BATCH = 200;
    const io    = req.app.get("io");
    let   sent  = 0;
    let   skip  = 0;

    while (true) {
      const users = await User.find({ isActive: true }).select("_id").skip(skip).limit(BATCH).lean();
      if (users.length === 0) break;
      await Promise.all(users.map((u) => pushNotif(io, u._id, { title, message })));
      sent += users.length;
      skip += BATCH;
      if (users.length < BATCH) break;
    }

    return res.json({ ok: true, sent });
  } catch (err) {
    return res.status(500).json({ ok: false, message: err.message });
  }
});

// ─── Sub-routers ──────────────────────────────────────────
router.use("/users",       require("./usersRoutes"));
router.use("/users",       require("./notificacionRoutes"));
router.use("/blocks",      require("./blocksRoutes"));
router.use("/communities", require("./communityAdminRoutes"));
router.use("/battles",     require("./battleRoutes"));

module.exports = router;