// ═══════════════════════════════════════════════════════════
// controllers/nx-control/usersController.js — Nakama
// Superadmin: gestión completa de usuarios
// ═══════════════════════════════════════════════════════════

const User      = require("../models/User");
const { Block } = require("../models/BlockReport");
const Chat      = require("../models/Chat");

const SYSTEM_BOT_ID   = process.env.SYSTEM_BOT_USER_ID || "000000000000000000000001";
const SYSTEM_BOT_NAME = "Nakama System";
const SYSTEM_BOT_AVATAR = process.env.SYSTEM_BOT_AVATAR || "";

// ─── safeUser ─────────────────────────────────────────────
const safeUser = (u) => ({
  _id:              u._id,
  username:         u.username,
  email:            u.email,
  role:             u.role,
  isOnline:         u.isOnline,
  avatarUrl:        u.avatarUrl,
  isSuspended:      u.isSuspended,
  suspendUntil:     u.suspendUntil,
  isBanned:         u.isBanned,
  banReason:        u.banReason,
  createdAt:        u.createdAt,
  followersCount:   u.followersCount,
  followingCount:   u.followingCount,
  warningCount:     u.warningCount,
  subscription:     u.subscription,
  rank:             u.rank,
  lastSeenAt:       u.lastSeenAt,
  moderationHistory:u.moderationHistory,
});

// ═══════════════════════════════════════════════════════════
// GET /nx-control/users
// ═══════════════════════════════════════════════════════════
exports.listUsers = async (req, res) => {
  try {
    const page  = Math.max(1, parseInt(req.query.page)  || 1);
    const limit = Math.min(50, parseInt(req.query.limit) || 15);
    const skip  = (page - 1) * limit;
    const filter = {};

    if (req.query.search) {
      const rx = new RegExp(req.query.search.trim(), "i");
      filter.$or = [{ username: rx }, { email: rx }];
    }
    if (req.query.role)                   filter.role        = req.query.role;
    if (req.query.status === "banned")    filter.isBanned    = true;
    if (req.query.status === "suspended") filter.isSuspended = true;
    if (req.query.status === "online")    filter.isOnline    = true;

    const [data, total] = await Promise.all([
      User.find(filter)
        .select("-password -passwordResetTokenHash -reveal")
        .sort({ createdAt: -1 })
        .skip(skip).limit(limit).lean(),
      User.countDocuments(filter),
    ]);

    return res.json({
      ok: true,
      data,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (err) {
    console.error("[SA users list]", err);
    return res.status(500).json({ ok: false, message: err.message });
  }
};

// ═══════════════════════════════════════════════════════════
// GET /nx-control/users/:id
// ═══════════════════════════════════════════════════════════
exports.getUser = async (req, res) => {
  try {
    const u = await User.findById(req.params.id)
      .select("-password -passwordResetTokenHash -reveal").lean();
    if (!u) return res.status(404).json({ ok: false, message: "Usuario no encontrado" });

    const [blocksGiven, blocksReceived] = await Promise.all([
      Block.countDocuments({ blocker: u._id }),
      Block.countDocuments({ blocked: u._id }),
    ]);

    return res.json({ ok: true, data: { ...u, blocksGiven, blocksReceived } });
  } catch (err) {
    return res.status(500).json({ ok: false, message: err.message });
  }
};

// ═══════════════════════════════════════════════════════════
// POST /nx-control/users/:id/ban
// ═══════════════════════════════════════════════════════════
exports.banUser = async (req, res) => {
  try {
    const u = await User.findById(req.params.id);
    if (!u) return res.status(404).json({ ok: false, message: "Usuario no encontrado" });
    if (u.role === "superadmin")
      return res.status(403).json({ ok: false, message: "No podés banear a otro superadmin" });

    await u.applyBan(
      req.body.reason || "Violación de términos de servicio",
      req.user._id,
      req.body.detail || "",
    );

    await _sendSystemMessage(u._id, "Tu cuenta ha sido baneada permanentemente por violación de los términos de Nakama.", {
      type: "ban", title: "Cuenta baneada", icon: "🚫", link: "/soporte",
    });

    return res.json({ ok: true, message: "Usuario baneado" });
  } catch (err) {
    return res.status(500).json({ ok: false, message: err.message });
  }
};

// ═══════════════════════════════════════════════════════════
// POST /nx-control/users/:id/unban
// ═══════════════════════════════════════════════════════════
exports.unbanUser = async (req, res) => {
  try {
    const u = await User.findById(req.params.id);
    if (!u) return res.status(404).json({ ok: false, message: "Usuario no encontrado" });

    u.isBanned  = false;
    u.banReason = "";
    u.bannedAt  = null;
    u.moderationHistory.push({ action: "unban", reason: req.body.reason || "Rehabilitado por superadmin", performedBy: req.user._id });
    await u.save();

    await _sendSystemMessage(u._id, "Tu cuenta ha sido rehabilitada. Ya podés volver a usar Nakama.", {
      type: "admin", title: "Cuenta rehabilitada", icon: "✅", link: "/chat",
    });

    return res.json({ ok: true, message: "Usuario desbaneado" });
  } catch (err) {
    return res.status(500).json({ ok: false, message: err.message });
  }
};

// ═══════════════════════════════════════════════════════════
// POST /nx-control/users/:id/freeze
// ═══════════════════════════════════════════════════════════
exports.freezeUser = async (req, res) => {
  try {
    const u = await User.findById(req.params.id);
    if (!u) return res.status(404).json({ ok: false, message: "Usuario no encontrado" });

    const until = req.body.until === "permanent"
      ? null
      : req.body.until ? new Date(req.body.until) : null;

    await u.applySuspension(req.body.reason || "Suspensión por moderación", req.user._id, until, req.body.detail || "");

    const msg = until
      ? `Tu cuenta fue suspendida hasta el ${until.toLocaleDateString("es-AR")}.`
      : "Tu cuenta fue suspendida temporalmente por el equipo de moderación.";

    await _sendSystemMessage(u._id, msg, {
      type: "freeze", title: "Cuenta suspendida", icon: "❄️", link: "/soporte",
    });

    return res.json({ ok: true, message: "Usuario suspendido" });
  } catch (err) {
    return res.status(500).json({ ok: false, message: err.message });
  }
};

// ═══════════════════════════════════════════════════════════
// POST /nx-control/users/:id/unfreeze
// ═══════════════════════════════════════════════════════════
exports.unfreezeUser = async (req, res) => {
  try {
    const u = await User.findById(req.params.id);
    if (!u) return res.status(404).json({ ok: false, message: "Usuario no encontrado" });

    u.isSuspended   = false;
    u.suspendReason = "";
    u.suspendUntil  = null;
    u.moderationHistory.push({ action: "unsuspend", reason: req.body.reason || "Suspensión levantada por superadmin", performedBy: req.user._id });
    await u.save();

    await _sendSystemMessage(u._id, "Tu suspensión fue levantada. Ya podés usar Nakama normalmente.", {
      type: "admin", title: "Suspensión levantada", icon: "✅", link: "/chat",
    });

    return res.json({ ok: true, message: "Suspensión levantada" });
  } catch (err) {
    return res.status(500).json({ ok: false, message: err.message });
  }
};

// ═══════════════════════════════════════════════════════════
// POST /nx-control/users/:id/warn
// ═══════════════════════════════════════════════════════════
exports.warnUser = async (req, res) => {
  try {
    if (!req.body.reason?.trim())
      return res.status(400).json({ ok: false, message: "reason requerido" });

    const u = await User.findById(req.params.id);
    if (!u) return res.status(404).json({ ok: false, message: "Usuario no encontrado" });

    u.warningCount = (u.warningCount || 0) + 1;
    u.moderationHistory.push({ action: "warn", reason: req.body.reason, performedBy: req.user._id });
    await u.save();

    await _sendSystemMessage(
      u._id,
      `⚠️ Advertencia (${u.warningCount}): ${req.body.reason}. Acumulación de advertencias puede derivar en suspensión.`,
      { type: "warn", title: `Advertencia #${u.warningCount}`, icon: "⚠️", link: "/chat" },
    );

    return res.json({ ok: true, message: "Advertencia enviada", warningCount: u.warningCount });
  } catch (err) {
    return res.status(500).json({ ok: false, message: err.message });
  }
};

// ═══════════════════════════════════════════════════════════
// PATCH /nx-control/users/:id/role
// ═══════════════════════════════════════════════════════════
exports.changeRole = async (req, res) => {
  try {
    const VALID = ["user", "user-pro", "user-premium", "moderator", "admin"];
    if (!VALID.includes(req.body.role))
      return res.status(400).json({ ok: false, message: "Rol inválido" });

    const u = await User.findById(req.params.id);
    if (!u) return res.status(404).json({ ok: false, message: "Usuario no encontrado" });
    if (u.role === "superadmin")
      return res.status(403).json({ ok: false, message: "No se puede modificar el rol de un superadmin" });

    const prevRole = u.role;
    u.role = req.body.role;
    if (req.body.role === "user-pro")     u.subscription.type = "pro";
    if (req.body.role === "user-premium") u.subscription.type = "premium";
    if (req.body.role === "user")         u.subscription.type = "free";
    await u.save();

    await _sendSystemMessage(
      u._id,
      `Tu rol en Nakama cambió de "${prevRole}" a "${req.body.role}".`,
      { type: "role", title: "Cambio de rol", icon: "🎖", link: "/perfil" },
    );

    return res.json({ ok: true, message: "Rol actualizado", role: u.role });
  } catch (err) {
    return res.status(500).json({ ok: false, message: err.message });
  }
};

// ═══════════════════════════════════════════════════════════
// POST /nx-control/users/:id/notify  (individual)
// ═══════════════════════════════════════════════════════════
exports.notifyUser = async (req, res) => {
  try {
    if (!req.body.message?.trim())
      return res.status(400).json({ ok: false, message: "message requerido" });

    const u = await User.findById(req.params.id);
    if (!u) return res.status(404).json({ ok: false, message: "Usuario no encontrado" });

    await _sendSystemMessage(u._id, req.body.message.trim(), {
      type: "admin", title: req.body.title || "Mensaje de Nakama", icon: "📨", link: "/chat",
    });

    return res.json({ ok: true, message: "Notificación enviada" });
  } catch (err) {
    return res.status(500).json({ ok: false, message: err.message });
  }
};

// ═══════════════════════════════════════════════════════════
// POST /nx-control/users/notify-batch
// body: { userIds, message, title? }
// ═══════════════════════════════════════════════════════════
exports.notifyBatch = async (req, res) => {
  try {
    const { userIds, message, title } = req.body;
    if (!Array.isArray(userIds) || !userIds.length)
      return res.status(400).json({ ok: false, message: "userIds requerido (array no vacío)" });
    if (!message?.trim())
      return res.status(400).json({ ok: false, message: "message requerido" });
    if (userIds.length > 500)
      return res.status(400).json({ ok: false, message: "Máximo 500 usuarios por batch" });

    await Promise.all(
      userIds.map((id) => _sendSystemMessage(id, message.trim(), {
        type: "admin", title: title || "Mensaje de Nakama", icon: "📨", link: "/chat",
      }))
    );

    return res.json({ ok: true, sent: userIds.length });
  } catch (err) {
    return res.status(500).json({ ok: false, message: err.message });
  }
};

// ═══════════════════════════════════════════════════════════
// POST /nx-control/users/notify-role
// body: { role, message, title? }
// ═══════════════════════════════════════════════════════════
exports.notifyRole = async (req, res) => {
  try {
    const { role, message, title } = req.body;
    if (!message?.trim())
      return res.status(400).json({ ok: false, message: "message requerido" });

    const filter = { isActive: true };
    if (role && role !== "all") filter.role = role;

    let sent = 0, skip = 0;
    while (true) {
      const users = await User.find(filter).select("_id").skip(skip).limit(200).lean();
      if (!users.length) break;
      await Promise.all(
        users.map((u) => _sendSystemMessage(u._id, message.trim(), {
          type: "admin", title: title || "Mensaje de Nakama", icon: "📨", link: "/chat",
        }))
      );
      sent += users.length;
      skip += 200;
      if (users.length < 200) break;
    }

    return res.json({ ok: true, sent, role: role || "all" });
  } catch (err) {
    return res.status(500).json({ ok: false, message: err.message });
  }
};

// ═══════════════════════════════════════════════════════════
// POST /nx-control/users/notify-all
// body: { message, title? }
// ═══════════════════════════════════════════════════════════
exports.notifyAll = async (req, res) => {
  try {
    const { message, title } = req.body;
    if (!message?.trim())
      return res.status(400).json({ ok: false, message: "message requerido" });

    let sent = 0, skip = 0;
    while (true) {
      const users = await User.find({ isActive: true }).select("_id").skip(skip).limit(200).lean();
      if (!users.length) break;
      await Promise.all(
        users.map((u) => _sendSystemMessage(u._id, message.trim(), {
          type: "admin", title: title || "Mensaje de Nakama", icon: "📨", link: "/chat",
        }))
      );
      sent += users.length;
      skip += 200;
      if (users.length < 200) break;
    }

    return res.json({ ok: true, sent });
  } catch (err) {
    return res.status(500).json({ ok: false, message: err.message });
  }
};

// ═══════════════════════════════════════════════════════════
// DELETE /nx-control/users/:id  (soft-delete)
// ═══════════════════════════════════════════════════════════
exports.deleteUser = async (req, res) => {
  try {
    const u = await User.findById(req.params.id);
    if (!u) return res.status(404).json({ ok: false, message: "Usuario no encontrado" });
    if (u.role === "superadmin")
      return res.status(403).json({ ok: false, message: "No podés eliminar a un superadmin" });

    const stamp     = Date.now();
    u.isActive      = false;
    u.isBanned      = true;
    u.email         = `deleted_${stamp}@nakama.deleted`;
    u.username      = `deleted_${stamp}`;
    u.displayName   = "Usuario eliminado";
    u.bio           = "";
    u.avatarUrl     = "";
    u.avatarPublicId= "";
    u.googleId      = null;
    u.password      = null;
    u.moderationHistory.push({ action: "ban", reason: "Cuenta eliminada por superadmin", performedBy: req.user._id });
    await u.save();

    return res.json({ ok: true, message: "Usuario eliminado (anonimizado)" });
  } catch (err) {
    return res.status(500).json({ ok: false, message: err.message });
  }
};

// ═══════════════════════════════════════════════════════════
// GET /nx-control/users/:id/blocks
// ═══════════════════════════════════════════════════════════
exports.getUserBlocks = async (req, res) => {
  try {
    const [given, received] = await Promise.all([
      Block.find({ blocker: req.params.id }).populate("blocked",  "username avatarUrl isOnline isBanned").sort({ createdAt: -1 }).lean(),
      Block.find({ blocked: req.params.id }).populate("blocker", "username avatarUrl isOnline isBanned").sort({ createdAt: -1 }).lean(),
    ]);
    return res.json({ ok: true, given, received });
  } catch (err) {
    return res.status(500).json({ ok: false, message: err.message });
  }
};

// ═══════════════════════════════════════════════════════════
// PRIVATE HELPER — _sendSystemMessage
// ─────────────────────────────────────────────────────────
// Hace 3 cosas en paralelo:
//   1. Chat p2p  → crea/reutiliza "Nakama System" ↔ usuario,
//                  guarda el mensaje y actualiza lastMessage.
//   2. Notif DB  → pushea en user.notifications para que el
//                  front pueda leerla aunque no esté online.
//   3. Sockets   → emite 4 eventos para cubrir campanita,
//                  sidebar de chats y chat abierto.
// ═══════════════════════════════════════════════════════════
async function _sendSystemMessage(targetUserId, text, meta = {}) {
  try {
    const io  = global.io;
    const now = new Date();

    // ── 1. Chat p2p Nakama System ↔ usuario ───────────────
    let chat = await Chat.findOne({
      type:         "p2p",
      participants: { $all: [SYSTEM_BOT_ID, targetUserId], $size: 2 },
    });

    if (!chat) {
      chat = await Chat.create({
        type:         "p2p",
        participants: [SYSTEM_BOT_ID, targetUserId],
        isReadOnly:   true,
        // Algunos esquemas guardan metadatos del "otro" participante:
        meta: {
          systemChat:   true,
          senderName:   SYSTEM_BOT_NAME,
          senderAvatar: SYSTEM_BOT_AVATAR,
        },
        messages: [],
      });
    }

    if (!chat.isReadOnly) chat.isReadOnly = true;

    const msgObj = {
      sender:     SYSTEM_BOT_ID,
      senderName: SYSTEM_BOT_NAME,   // ← nombre visible en el chat
      text,
      isSystem:   true,
      status:     "sent",
      createdAt:  now,
    };

    chat.messages.push(msgObj);
    chat.lastMessage  = text;
    chat.lastActivity = now;

    const unread = chat.unreadCount?.get?.(String(targetUserId)) || 0;
    chat.unreadCount?.set?.(String(targetUserId), unread + 1);

    await chat.save();

    // ── 2. Notificación persistida en user.notifications ──
    //    El front puede leerla con GET /notifications o al
    //    montar el hook useNotifications.
    const notifEntry = {
      title:     meta.title  || "Mensaje de Nakama",
      body:      text,
      type:      meta.type   || "admin",
      icon:      meta.icon   || "🔔",
      link:      meta.link   || "/chat",
      chatId:    chat._id,
      read:      false,
      createdAt: now,
      fromSystem: true,
    };

    await User.findByIdAndUpdate(targetUserId, {
      $push: {
        notifications: { $each: [notifEntry], $position: 0, $slice: 100 },
      },
    });

    // ── 3. Sockets ─────────────────────────────────────────
    if (io) {
      // Payload unificado que el front recibe en ambas campanitas
      const socketPayload = {
        id:             `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        title:          meta.title  || "Mensaje de Nakama",
        message:        text,
        type:           meta.type   || "admin",
        icon:           meta.icon   || "🔔",
        link:           meta.link   || "/chat",
        chatId:         chat._id.toString(),
        senderName:     SYSTEM_BOT_NAME,
        senderAvatar:   SYSTEM_BOT_AVATAR,
        createdAt:      now.toISOString(),
        read:           false,
        fromSystem:     true,
      };

      // a) Campanita Navbar + campanita Chat sidebar
      io.to(`user_${targetUserId}`).emit("admin:notification", socketPayload);

      // b) Notificación clásica (si el front escucha "notification" también)
      io.to(`user_${targetUserId}`).emit("notification", socketPayload);

      // c) Sidebar de chats: refrescar lista
      io.to(`user_${targetUserId}`).emit("system_notification", {
        chatId:       chat._id,
        senderName:   SYSTEM_BOT_NAME,
        senderAvatar: SYSTEM_BOT_AVATAR,
        message:      text,
        isReadOnly:   true,
      });

      // d) Si el chat está abierto: mensaje en tiempo real
      io.to(`chat_${chat._id}`).emit("new_message", {
        chatId:  chat._id,
        message: {
          sender:      SYSTEM_BOT_ID,
          senderName:  SYSTEM_BOT_NAME,
          senderAvatar:SYSTEM_BOT_AVATAR,
          text,
          isSystem:    true,
          createdAt:   now,
        },
      });
    }

    return chat.messages[chat.messages.length - 1];
  } catch (err) {
    console.error("[_sendSystemMessage]", err.message);
    return null;
  }
}