// ═══════════════════════════════════════════════════════════
// controllers/chatController.js — Nakama
// ═══════════════════════════════════════════════════════════

const Chat = require("../models/Chat");
const User = require("../models/User");

// Límites por rol
const LIMITS = {
  user:           { comunidad: 300,   grupos: 5   },
  "user-pro":     { comunidad: 10000, grupos: 20  },
  "user-premium": { comunidad: 50000, grupos: 100 },
  moderator:      { comunidad: 50000, grupos: 100 },
  admin:          { comunidad: 50000, grupos: 100 },
  superadmin:     { comunidad: 50000, grupos: 100 },
};

// ═══════════════════════════════════════════════════════════
// GET /chats?type=chats|grupos|comunidades
// ═══════════════════════════════════════════════════════════
exports.getChats = async (req, res) => {
  try {
    const { type = "chats" } = req.query;
    const userId = req.user.id;
    const chatType = type === "chats" ? "p2p" : type === "grupos" ? "grupo" : "comunidad";

    const chats = await Chat.find({
      $or: [{ participants: userId }, { "members.userId": userId }],
      type:     chatType,
      isActive: true,
      isReadOnly: conv.isReadOnly ?? false,
    })
      .sort({ lastActivity: -1 })
      .select("name avatarUrl type lastMessage lastActivity participants members unread theme pinned")
      .lean();

    const formatted = chats.map(chat => {
      const member = chat.members?.find(m => m.userId?.toString() === userId);
      return {
        _id:         chat._id,
        type:        chat.type === "p2p" ? "private" : chat.type,
        name:        chat.name,
        avatarUrl:   chat.avatarUrl,
        lastMessage: chat.lastMessage,
        lastTime:    formatTime(chat.lastActivity),
        unread:      0,
        memberCount: chat.members?.length ?? chat.participants?.length ?? 2,
        theme:       chat.theme,
        pinned:      chat.pinned?.some(id => id.toString() === userId) ?? false,
        muted:       member?.muted ?? false,
        online:      false,
      };
    });

    res.json(formatted);
  } catch (err) {
    console.error("[getChats]", err);
    res.status(500).json({ message: "Error al obtener chats." });
  }
};

// ═══════════════════════════════════════════════════════════
// POST /chats — crear p2p / grupo / comunidad
// ═══════════════════════════════════════════════════════════
exports.createChat = async (req, res) => {
  try {
    const { type, name, members = [] } = req.body;
    const userId  = req.user.id;
    const creator = await User.findById(userId).select("role username avatarUrl");
    const role    = creator.role;

    if (type === "grupo" || type === "comunidad") {
      const existing = await Chat.countDocuments({ "members.userId": userId, type });
      const limit = LIMITS[role]?.grupos ?? 5;
      if (existing >= limit) {
        return res.status(403).json({
          message: `Límite de ${limit} ${type}s alcanzado para tu plan.`,
        });
      }
    }

    // P2P — si ya existe, devolver el existente
    if (type === "p2p" || type === "private") {
      const [targetId] = members;
      if (!targetId) return res.status(400).json({ message: "Falta el destinatario." });

      const existing = await Chat.findOne({
        type: "p2p",
        participants: { $all: [userId, targetId] },
      });

      if (existing) {
        const target = await User.findById(targetId).select("username avatarUrl").lean();
        return res.json({
          _id:      existing._id,
          type:     "private",
          name:     target?.username ?? "Usuario",
          avatarUrl:target?.avatarUrl ?? "",
          unread:   0,
          lastMessage: existing.lastMessage ?? "",
          lastTime: formatTime(existing.lastActivity),
        });
      }

      const target = await User.findById(targetId).select("username avatarUrl").lean();
      const newChat = await Chat.create({
        type:         "p2p",
        name:         target?.username ?? "Chat",
        participants: [userId, targetId],
        members:      [],
        lastActivity: new Date(),
      });

      return res.status(201).json({
        _id:      newChat._id,
        type:     "private",
        name:     target?.username ?? "Chat",
        avatarUrl:target?.avatarUrl ?? "",
        unread:   0,
        lastMessage: "",
        lastTime: "Ahora",
      });
    }

    // Grupo / comunidad
    const allMembers = [userId, ...members.filter(m => m !== userId)];
    const maxMembers = LIMITS[role]?.[type === "comunidad" ? "comunidad" : "grupos"] ?? 300;

    const newChat = await Chat.create({
      type,
      name:         name ?? (type === "grupo" ? "Nuevo grupo" : "Nueva comunidad"),
      participants: [],
      members:      allMembers.map((id, i) => ({
        userId: id,
        role:   i === 0 ? "admin" : "member",
      })),
      maxMembers,
      lastActivity: new Date(),
    });

    return res.status(201).json({
      _id:        newChat._id,
      type,
      name:       newChat.name,
      unread:     0,
      lastMessage:"",
      lastTime:   "Ahora",
      memberCount:allMembers.length,
    });
  } catch (err) {
    console.error("[createChat]", err);
    res.status(500).json({ message: "Error al crear el chat." });
  }
};

// ═══════════════════════════════════════════════════════════
// GET /chats/suggestions
// ═══════════════════════════════════════════════════════════
exports.getSuggestions = async (req, res) => {
  try {
    const userId = req.user.id;

    const myChats = await Chat.find({
      type: "p2p", participants: userId,
    }).select("participants").lean();

    const alreadyChatting = new Set(
      myChats.flatMap(c => c.participants.map(p => p.toString()))
    );
    alreadyChatting.add(userId.toString());

    const suggestions = await User.find({
      _id:      { $nin: [...alreadyChatting] },
      isActive: { $ne: false },
    })
      .select("username avatarUrl role")
      .limit(5)
      .lean();

    res.json(suggestions.map(u => ({
      _id:        String(u._id),
      username:   u.username,
      avatarUrl:  u.avatarUrl ?? null,
      role:       u.role,
      source:     "nakama",
      mutualCount:0,
    })));
  } catch (err) {
    console.error("[getSuggestions]", err);
    res.json([]);
  }
};

// ═══════════════════════════════════════════════════════════
// GET /chats/search-users?q=&source=
// ═══════════════════════════════════════════════════════════
exports.searchUsers = async (req, res) => {
  try {
    const { q = "", source = "all" } = req.query;
    const userId = req.user.id;
    if (String(q).length < 2) return res.json([]);

    const regex = new RegExp(String(q).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");

    const users = await User.find({
      _id:      { $ne: userId },
      username: regex,
      isActive: { $ne: false },
    })
      .select("username avatarUrl role")
      .limit(20)
      .lean();

    res.json(users.map(u => ({
      _id:      String(u._id),
      username: u.username,
      avatarUrl:u.avatarUrl ?? null,
      role:     u.role,
      source:   "nakama",
    })));
  } catch (err) {
    console.error("[searchUsers]", err);
    res.json([]);
  }
};

// ═══════════════════════════════════════════════════════════
// GET /chats/social-search?platform=instagram|tiktok|facebook&q=
// Busca usuarios de Nakama por su handle de red social
// ═══════════════════════════════════════════════════════════
exports.socialSearch = async (req, res) => {
  try {
    const { platform, q } = req.query;
    const userId = req.user.id;

    if (!platform || !q || String(q).length < 2) return res.json([]);

    const allowedPlatforms = ["instagram", "tiktok", "facebook"];
    if (!allowedPlatforms.includes(String(platform))) {
      return res.status(400).json({ message: "Plataforma no soportada." });
    }

    const cleanQ = String(q).replace(/^@/, "").trim();
    const regex  = new RegExp(cleanQ.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");

    // Buscar en Nakama usuarios que tengan ese handle vinculado
    // O que su username coincida (fallback)
    const socialField = `socialLinks.${platform}`;

    const users = await User.find({
      _id:      { $ne: userId },
      isActive: { $ne: false },
      $or: [
        { [socialField]: regex },
        { username: regex },
      ],
    })
      .select(`username avatarUrl role socialLinks`)
      .limit(15)
      .lean();

    if (users.length === 0) {
      // Devolver placeholder para que el frontend sepa que no está en Nakama
      return res.json([{
        nakamaId:    null,
        username:    cleanQ,
        displayName: cleanQ,
        avatarUrl:   null,
        platform:    String(platform),
        inNakama:    false,
        isContact:   false,
        profileUrl:  buildProfileUrl(String(platform), cleanQ),
        followers:   null,
        bio:         null,
      }]);
    }

    const result = users.map(u => {
      const handle = u.socialLinks?.[platform] ?? u.username;
      return {
        nakamaId:    String(u._id),
        username:    handle,
        displayName: u.username,
        avatarUrl:   u.avatarUrl ?? null,
        platform:    String(platform),
        inNakama:    true,
        isContact:   false,
        profileUrl:  buildProfileUrl(String(platform), handle),
        followers:   null,
        bio:         null,
      };
    });

    res.json(result);
  } catch (err) {
    console.error("[socialSearch]", err);
    res.status(500).json({ message: "Error al buscar en redes sociales." });
  }
};

// ═══════════════════════════════════════════════════════════
// GET /chats/contacts — agenda de contactos
// ═══════════════════════════════════════════════════════════
exports.getContacts = async (req, res) => {
  try {
    const userId = req.user.id;
    const user   = await User.findById(userId).select("contacts").lean();

    if (!user?.contacts?.length) return res.json([]);

    // Poblar los contactos
    const populated = await User.find({
      _id: { $in: user.contacts.map(c => c.userId) },
    }).select("username avatarUrl role").lean();

    const map = {};
    populated.forEach(u => { map[String(u._id)] = u; });

    const result = user.contacts.map(c => {
      const u = map[String(c.userId)];
      if (!u) return null;
      return {
        userId:   String(u._id),
        username: u.username,
        avatarUrl:u.avatarUrl ?? null,
        role:     u.role,
        alias:    c.alias ?? "",
        notes:    c.notes ?? "",
        source:   c.source ?? "nakama",
        savedAt:  c.savedAt,
      };
    }).filter(Boolean);

    res.json(result);
  } catch (err) {
    console.error("[getContacts]", err);
    res.status(500).json({ message: "Error al obtener contactos." });
  }
};

// ═══════════════════════════════════════════════════════════
// POST /chats/contacts — guardar contacto en agenda
// ═══════════════════════════════════════════════════════════
exports.addContact = async (req, res) => {
  try {
    const { targetUserId, alias = "", notes = "", source = "nakama" } = req.body;
    const userId = req.user.id;

    if (!targetUserId) return res.status(400).json({ message: "Falta el ID del usuario." });

    const target = await User.findById(targetUserId).select("username avatarUrl").lean();
    if (!target) return res.status(404).json({ message: "Usuario no encontrado." });

    // Verificar si ya está en la agenda
    const me = await User.findById(userId);
    const already = me.contacts?.find(c => c.userId?.toString() === targetUserId);

    if (already) {
      // Actualizar alias/notes si se pasan
      if (alias)  already.alias  = alias;
      if (notes)  already.notes  = notes;
      if (source) already.source = source;
      await me.save();
      return res.json({
        message:  "Contacto ya existente, actualizado.",
        username: target.username,
        avatarUrl:target.avatarUrl,
      });
    }

    // Agregar a la agenda
    if (!me.contacts) me.contacts = [];
    me.contacts.push({
      userId:  targetUserId,
      alias,
      notes,
      source,
      savedAt: new Date(),
    });
    await me.save();

    res.status(201).json({
      message:  "Contacto guardado en tu agenda.",
      username: target.username,
      avatarUrl:target.avatarUrl,
    });
  } catch (err) {
    console.error("[addContact]", err);
    res.status(500).json({ message: "Error al guardar contacto." });
  }
};

// ═══════════════════════════════════════════════════════════
// DELETE /chats/contacts/:userId — eliminar de agenda
// ═══════════════════════════════════════════════════════════
exports.removeContact = async (req, res) => {
  try {
    const userId = req.user.id;
    await User.updateOne(
      { _id: userId },
      { $pull: { contacts: { userId: req.params.userId } } }
    );
    res.json({ message: "Contacto eliminado de tu agenda." });
  } catch (err) {
    console.error("[removeContact]", err);
    res.status(500).json({ message: "Error al eliminar contacto." });
  }
};

// ═══════════════════════════════════════════════════════════
// GET /chats/:id/messages
// ═══════════════════════════════════════════════════════════
exports.getMessages = async (req, res) => {
  try {
    const { id } = req.params;
    const { page = 1, limit = 50 } = req.query;
    const userId = req.user.id;

    const chat = await Chat.findOne({
      _id: id,
      $or: [{ participants: userId }, { "members.userId": userId }],
    }).select("messages").lean();

    if (!chat) return res.status(404).json({ message: "Chat no encontrado." });

    const all  = chat.messages ?? [];
    const skip = Math.max(0, all.length - Number(page) * Number(limit));
    const msgs = all.slice(skip, skip + Number(limit));

    res.json(msgs);
  } catch (err) {
    console.error("[getMessages]", err);
    res.status(500).json({ message: "Error al obtener mensajes." });
  }
};

// ═══════════════════════════════════════════════════════════
// POST /chats/:id/messages
// ═══════════════════════════════════════════════════════════
exports.sendMessage = async (req, res) => {
  try {
    const { id }    = req.params;
    const { content, type = "text", fileUrl } = req.body;
    const userId    = req.user.id;
    const user      = await User.findById(userId).select("username");

    const chat = await Chat.findOne({
      _id: id,
      $or: [{ participants: userId }, { "members.userId": userId }],
    });

    if (!chat) return res.status(404).json({ message: "Chat no encontrado." });

    const newMsg = {
      senderId:   userId,
      senderName: user.username,
      content:    content ?? "",
      type,
      fileUrl,
      read:       false,
      readBy:     [userId],
      createdAt:  new Date(),
      updatedAt:  new Date(),
    };

    chat.messages.push(newMsg);
    chat.lastMessage  = content?.slice(0, 80) ?? "Archivo";
    chat.lastActivity = new Date();
    await chat.save();

    res.status(201).json(chat.messages[chat.messages.length - 1]);
  } catch (err) {
    console.error("[sendMessage]", err);
    res.status(500).json({ message: "Error al enviar mensaje." });
  }
};

// ─── Helper ───────────────────────────────────────────────
function formatTime(date) {
  if (!date) return "";
  const now  = new Date();
  const d    = new Date(date);
  const diff = (now - d) / 1000;
  if (diff < 60)    return "Ahora";
  if (diff < 3600)  return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return d.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });
  return d.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit" });
}

function buildProfileUrl(platform, handle) {
  const h = handle.replace(/^@/, "");
  if (platform === "instagram") return `https://instagram.com/${h}`;
  if (platform === "tiktok")    return `https://tiktok.com/@${h}`;
  if (platform === "facebook")  return `https://facebook.com/${h}`;
  return "#";
}