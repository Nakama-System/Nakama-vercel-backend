// ═══════════════════════════════════════════════════════════
// controllers/superadminController.js
// ═══════════════════════════════════════════════════════════

const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const Community = require("../models/Community");
const mongoose = require("mongoose");

const legalSchema = new mongoose.Schema({
  type: { type: String, enum: ["terms", "privacy"], unique: true },
  content: { type: String, default: "" },
  version: { type: String, default: "1.0" },
  updatedAt: { type: Date, default: Date.now },
});
const Legal = mongoose.models.Legal || mongoose.model("Legal", legalSchema);

// ══════════════════════════════════════════════════════════
// REVEAL LOGIN
// ══════════════════════════════════════════════════════════
exports.revealLogin = async (req, res) => {
  try {
    const { email, reveal } = req.body;
    console.log("📩 [reveal] body recibido:", {
      email,
      reveal: reveal ? "***" : "VACÍO",
    });

    if (!email || !reveal) {
      return res.status(400).json({ ok: false, message: "Faltan campos" });
    }

    // .lean() para traer el documento plano sin filtros de Mongoose
    const user = await User.findOne({
      email: email.toLowerCase().trim(),
    }).lean();
    console.log(
      "👤 [reveal] usuario:",
      user?.email,
      "| role:",
      user?.role,
      "| revealHash:",
      user?.revealHash ? "existe" : "NULL",
    );

    if (!user || user.role !== "superadmin") {
      return res
        .status(401)
        .json({ ok: false, message: "Credenciales inválidas" });
    }

    if (!user.revealHash) {
      console.log("❌ [reveal] no tiene revealHash en DB");
      return res
        .status(401)
        .json({ ok: false, message: "Credenciales inválidas" });
    }

    const match = await bcrypt.compare(String(reveal), user.revealHash);
    console.log("🔐 [reveal] bcrypt match:", match);

    if (!match) {
      return res
        .status(401)
        .json({ ok: false, message: "Credenciales inválidas" });
    }

    // Incrementar sessionVersion con update directo (lean no tiene .save())
    const newVersion = (user.sessionVersion || 0) + 1;
    await User.findByIdAndUpdate(user._id, { sessionVersion: newVersion });

    const token = jwt.sign(
      { id: user._id, role: user.role, sessionVersion: newVersion },
      "Todas las sesiones anteriores fueron invalidadas DFADFADFASDFASFLCVLKCZVLKZ",
      { expiresIn: "8h" },
    );

    console.log("✅ [reveal] login exitoso para:", user.email);
    return res.json({
      ok: true,
      token,
      user: { id: user._id, email: user.email, username: user.username },
    });
  } catch (err) {
    console.error("[revealLogin] ERROR:", err);
    return res.status(500).json({ ok: false, message: "Error interno" });
  }
};

// ══════════════════════════════════════════════════════════
// KICK ALL SESSIONS
// ══════════════════════════════════════════════════════════
exports.kickAllSessions = async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ ok: false });

    user.sessionVersion = (user.sessionVersion || 0) + 1;
    await user.save();

    const token = jwt.sign(
      { id: user._id, role: user.role, sessionVersion: user.sessionVersion },
      "Todas las sesiones anteriores fueron invalidadas DFADFADFASDFASFLCVLKCZVLKZ",
      { expiresIn: "8h" },
    );

    return res.json({
      ok: true,
      token,
      message: "Todas las sesiones anteriores fueron invalidadas",
    });
  } catch (err) {
    return res.status(500).json({ ok: false, message: err.message });
  }
};

// ══════════════════════════════════════════════════════════
// DASHBOARD STATS
// ══════════════════════════════════════════════════════════
exports.getDashboardStats = async (req, res) => {
  try {
    const [
      totalUsers,
      newUsersToday,
      totalCommunities,
      onlineUsers,
      frozenUsers,
      bannedUsers,
    ] = await Promise.all([
      User.countDocuments(),
      User.countDocuments({
        createdAt: { $gte: new Date(new Date().setHours(0, 0, 0, 0)) },
      }),
      Community.countDocuments(),
      User.countDocuments({ isOnline: true }),
      User.countDocuments({ isSuspended: true }),
      User.countDocuments({ isBanned: true }),
    ]);

    return res.json({
      ok: true,
      stats: {
        totalUsers,
        newUsersToday,
        totalCommunities,
        onlineUsers,
        frozenUsers,
        bannedUsers,
      },
    });
  } catch (err) {
    return res.status(500).json({ ok: false, message: err.message });
  }
};

// ══════════════════════════════════════════════════════════
// USERS
// ══════════════════════════════════════════════════════════
exports.getUsers = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(50, parseInt(req.query.limit) || 20);
    const search = (req.query.search || "").trim();
    const filter = search
      ? {
          $or: [
            { username: { $regex: search, $options: "i" } },
            { email: { $regex: search, $options: "i" } },
          ],
        }
      : {};

    const [users, total] = await Promise.all([
      User.find(filter)
        .select(
          "username email role avatarUrl isOnline isSuspended suspendUntil isBanned createdAt subscription",
        )
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit),
      User.countDocuments(filter),
    ]);

    return res.json({
      ok: true,
      data: users,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (err) {
    return res.status(500).json({ ok: false, message: err.message });
  }
};

exports.freezeUser = async (req, res) => {
  try {
    const { until } = req.body;
    const user = await User.findByIdAndUpdate(
      req.params.id,
      { isSuspended: true, suspendUntil: until === "permanent" ? null : until },
      { new: true },
    ).select("username email isSuspended suspendUntil");
    if (!user)
      return res
        .status(404)
        .json({ ok: false, message: "Usuario no encontrado" });
    return res.json({ ok: true, user });
  } catch (err) {
    return res.status(500).json({ ok: false, message: err.message });
  }
};

exports.unfreezeUser = async (req, res) => {
  try {
    const user = await User.findByIdAndUpdate(
      req.params.id,
      { isSuspended: false, suspendUntil: null },
      { new: true },
    ).select("username email isSuspended");
    if (!user)
      return res
        .status(404)
        .json({ ok: false, message: "Usuario no encontrado" });
    return res.json({ ok: true, user });
  } catch (err) {
    return res.status(500).json({ ok: false, message: err.message });
  }
};

exports.banUser = async (req, res) => {
  try {
    const { reason } = req.body;
    const user = await User.findByIdAndUpdate(
      req.params.id,
      { isBanned: true, banReason: reason || "" },
      { new: true },
    ).select("username email isBanned banReason");
    if (!user)
      return res
        .status(404)
        .json({ ok: false, message: "Usuario no encontrado" });
    return res.json({ ok: true, user });
  } catch (err) {
    return res.status(500).json({ ok: false, message: err.message });
  }
};

exports.unbanUser = async (req, res) => {
  try {
    const user = await User.findByIdAndUpdate(
      req.params.id,
      { isBanned: false, banReason: "" },
      { new: true },
    ).select("username email isBanned");
    if (!user)
      return res
        .status(404)
        .json({ ok: false, message: "Usuario no encontrado" });
    return res.json({ ok: true, user });
  } catch (err) {
    return res.status(500).json({ ok: false, message: err.message });
  }
};

exports.deleteUser = async (req, res) => {
  try {
    await User.findByIdAndDelete(req.params.id);
    return res.json({ ok: true, message: "Usuario eliminado" });
  } catch (err) {
    return res.status(500).json({ ok: false, message: err.message });
  }
};

// ══════════════════════════════════════════════════════════
// COMMUNITIES
// ══════════════════════════════════════════════════════════
exports.getCommunities = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(50, parseInt(req.query.limit) || 20);
    const search = (req.query.search || "").trim();
    const filter = search ? { name: { $regex: search, $options: "i" } } : {};

    const [communities, total] = await Promise.all([
      Community.find(filter)
        .select(
          "name description avatarUrl memberCount likeCount theme messagingOpen createdAt",
        )
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit),
      Community.countDocuments(filter),
    ]);

    return res.json({
      ok: true,
      data: communities,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (err) {
    return res.status(500).json({ ok: false, message: err.message });
  }
};

exports.deleteCommunity = async (req, res) => {
  try {
    await Community.findByIdAndDelete(req.params.id);
    return res.json({ ok: true, message: "Comunidad eliminada" });
  } catch (err) {
    return res.status(500).json({ ok: false, message: err.message });
  }
};

exports.freezeCommunity = async (req, res) => {
  try {
    const { freeze } = req.body;
    const community = await Community.findByIdAndUpdate(
      req.params.id,
      { messagingOpen: !freeze },
      { new: true },
    ).select("name messagingOpen");
    if (!community)
      return res
        .status(404)
        .json({ ok: false, message: "Comunidad no encontrada" });
    return res.json({ ok: true, community });
  } catch (err) {
    return res.status(500).json({ ok: false, message: err.message });
  }
};

// ══════════════════════════════════════════════════════════
// REPORTS
// ══════════════════════════════════════════════════════════
exports.getReports = async (req, res) => {
  try {
    return res.json({
      ok: true,
      data: [],
      pagination: { page: 1, total: 0, pages: 0 },
    });
  } catch (err) {
    return res.status(500).json({ ok: false, message: err.message });
  }
};

exports.resolveReport = async (req, res) => {
  try {
    return res.json({ ok: true, message: "Reporte resuelto" });
  } catch (err) {
    return res.status(500).json({ ok: false, message: err.message });
  }
};

// ══════════════════════════════════════════════════════════
// TERMS & PRIVACY
// ══════════════════════════════════════════════════════════
exports.getTerms = async (req, res) => {
  try {
    let doc = await Legal.findOne({ type: "terms" });
    if (!doc) doc = { type: "terms", content: "", version: "1.0" };
    return res.json({ ok: true, data: doc });
  } catch (err) {
    return res.status(500).json({ ok: false, message: err.message });
  }
};

exports.updateTerms = async (req, res) => {
  try {
    const { content, version } = req.body;
    const doc = await Legal.findOneAndUpdate(
      { type: "terms" },
      { content, version, updatedAt: new Date() },
      { upsert: true, new: true },
    );
    return res.json({ ok: true, data: doc });
  } catch (err) {
    return res.status(500).json({ ok: false, message: err.message });
  }
};

exports.getPrivacy = async (req, res) => {
  try {
    let doc = await Legal.findOne({ type: "privacy" });
    if (!doc) doc = { type: "privacy", content: "", version: "1.0" };
    return res.json({ ok: true, data: doc });
  } catch (err) {
    return res.status(500).json({ ok: false, message: err.message });
  }
};

exports.updatePrivacy = async (req, res) => {
  try {
    const { content, version } = req.body;
    const doc = await Legal.findOneAndUpdate(
      { type: "privacy" },
      { content, version, updatedAt: new Date() },
      { upsert: true, new: true },
    );
    return res.json({ ok: true, data: doc });
  } catch (err) {
    return res.status(500).json({ ok: false, message: err.message });
  }
};
