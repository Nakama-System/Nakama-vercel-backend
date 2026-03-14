// ═══════════════════════════════════════════════════════════
// routes/chatRoutes.js — Nakama
// FIX: avatares correctos · persistencia · bloquear · reportar
// ═══════════════════════════════════════════════════════════

const express        = require("express");
const router         = express.Router();
const { protect }    = require("../middlewares/authMiddleware");
const Chat           = require("../models/Chat");
const User           = require("../models/User");
const { Block, Report } = require("../models/BlockReport");

router.use(protect);

// ─── Helpers ──────────────────────────────────────────────
function formatTime(date) {
  if (!date) return "";
  const diff = (Date.now() - new Date(date)) / 1000;
  const d    = new Date(date);
  if (diff < 60)    return "Ahora";
  if (diff < 3600)  return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return d.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });
  return d.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit" });
}
function buildProfileUrl(platform, handle) {
  const h = String(handle).replace(/^@/, "");
  if (platform === "instagram") return `https://instagram.com/${h}`;
  if (platform === "tiktok")    return `https://tiktok.com/@${h}`;
  return `https://facebook.com/${h}`;
}

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
// FIX: para p2p devuelve SIEMPRE nombre+avatar del OTRO user
// ═══════════════════════════════════════════════════════════
router.get("/", async (req, res) => {
  try {
    const { type = "chats" } = req.query;
    const userId   = req.user.id;
    const chatType = type === "grupos" ? "grupo" : type === "comunidades" ? "comunidad" : "p2p";

    const chats = await Chat.find({
      $or: [{ participants: userId }, { "members.userId": userId }],
      type:     chatType,
      isActive: { $ne: false },
    })
      .sort({ lastActivity: -1 })
      .select("name avatarUrl type lastMessage lastActivity participants members theme pinned unreadCount")
      .lean();

    // ── FIX AVATAR: para p2p, poblar el OTRO participante ──
    let otherMap = {};
    if (chatType === "p2p") {
      const otherIds = chats.flatMap(c =>
        (c.participants ?? []).filter(p => String(p) !== String(userId))
      );
      const otherUsers = await User.find({ _id: { $in: otherIds } })
        .select("_id username avatarUrl").lean();
      otherUsers.forEach(u => { otherMap[String(u._id)] = u; });
    }

    // ── FIX: bloqueos para filtrar chats bloqueados ────────
    const blocks = await Block.find({ $or: [{ blocker: userId }, { blocked: userId }] })
      .select("blocker blocked").lean();
    const blockedSet = new Set(blocks.map(b =>
      String(b.blocker) === String(userId) ? String(b.blocked) : String(b.blocker)
    ));

    const result = chats
      .map(chat => {
        const member   = chat.members?.find(m => String(m.userId) === String(userId));
        let name       = chat.name || "Chat";
        let avatarUrl  = chat.avatarUrl || "";
        let isBlocked  = false;
        let otherId    = null;

        if (chat.type === "p2p") {
          otherId = (chat.participants ?? []).find(p => String(p) !== String(userId));
          const other = otherId ? otherMap[String(otherId)] : null;
          if (other) {
            // ← SIEMPRE nombre y avatar del OTRO
            name      = other.username;
            avatarUrl = other.avatarUrl || "";
          }
          isBlocked = otherId ? blockedSet.has(String(otherId)) : false;
        }

        return {
          _id:        String(chat._id),
          type:       chat.type === "p2p" ? "private" : chat.type,
          name,
          avatarUrl,
          lastMessage: chat.lastMessage || "",
          lastTime:    formatTime(chat.lastActivity),
          unread:      chat.unreadCount?.get?.(String(userId)) ?? chat.unreadCount?.[String(userId)] ?? 0,
          memberCount: chat.members?.length ?? chat.participants?.length ?? 2,
          theme:       chat.theme || "default",
          pinned:      chat.pinned?.some(id => String(id) === String(userId)) ?? false,
          muted:       member?.muted ?? false,
          online:      false,
          isBlocked,
          otherId:     otherId ? String(otherId) : null,
        };
      })
      // Chats bloqueados van al final en lugar de ocultarse (igual que WhatsApp)
      .sort((a, b) => Number(a.isBlocked) - Number(b.isBlocked));

    res.json(result);
  } catch (err) {
    console.error("[GET /chats]", err);
    res.status(500).json({ message: "Error al obtener chats." });
  }
});

// ═══════════════════════════════════════════════════════════
// POST /chats — crear p2p / grupo / comunidad
// FIX: devuelve nombre+avatar del OTRO en p2p
// ═══════════════════════════════════════════════════════════
router.post("/", async (req, res) => {
  try {
    const { type = "private", name, members = [] } = req.body;
    const userId   = req.user.id;
    const chatType = type === "private" ? "p2p" : type;

    // ── P2P ──────────────────────────────────────────────
    if (chatType === "p2p") {
      const [targetId] = members;
      if (!targetId) return res.status(400).json({ message: "Falta el destinatario." });

      // Verificar bloqueo
      const block = await Block.findOne({
        $or: [
          { blocker: userId, blocked: targetId },
          { blocker: targetId, blocked: userId },
        ],
      });
      if (block) {
        return res.status(403).json({ message: "No podés chatear con este usuario." });
      }

      // Si ya existe la sala, devolverla con datos del OTRO
      const existing = await Chat.findOne({
        type: "p2p",
        participants: { $all: [userId, targetId] },
      }).lean();

      const target = await User.findById(targetId).select("username avatarUrl").lean();

      if (existing) {
        return res.json({
          _id:        String(existing._id),
          type:       "private",
          // ← FIX: siempre el nombre/avatar del otro
          name:       target?.username ?? "Usuario",
          avatarUrl:  target?.avatarUrl ?? "",
          unread:     0,
          lastMessage:existing.lastMessage ?? "",
          lastTime:   formatTime(existing.lastActivity),
          otherId:    String(targetId),
        });
      }

      const newChat = await Chat.create({
        type:         "p2p",
        name:         "", // no se usa para p2p
        participants: [userId, targetId],
        members:      [],
        lastActivity: new Date(),
      });

      return res.status(201).json({
        _id:       String(newChat._id),
        type:      "private",
        name:      target?.username ?? "Chat",
        avatarUrl: target?.avatarUrl ?? "",
        unread:    0,
        lastMessage:"",
        lastTime:  "Ahora",
        otherId:   String(targetId),
      });
    }

    // ── Grupo / Comunidad ─────────────────────────────────
    const creator = await User.findById(userId).select("role").lean();
    const role    = creator?.role ?? "user";
    const count   = await Chat.countDocuments({ "members.userId": userId, type: chatType });
    const limit   = chatType === "comunidad"
      ? LIMITS[role]?.comunidad ?? 300
      : LIMITS[role]?.grupos    ?? 5;

    if (count >= limit) {
      return res.status(403).json({
        message: `Límite de ${limit} ${chatType}s alcanzado para tu plan.`,
      });
    }

    const allMembers = [userId, ...members.filter(m => String(m) !== String(userId))];
    const newChat = await Chat.create({
      type:         chatType,
      name:         name?.trim() || (chatType === "grupo" ? "Nuevo grupo" : "Nueva comunidad"),
      participants: [],
      members:      allMembers.map((id, i) => ({ userId: id, role: i === 0 ? "admin" : "member" })),
      lastActivity: new Date(),
    });

    return res.status(201).json({
      _id:        String(newChat._id),
      type:       chatType,
      name:       newChat.name,
      unread:     0,
      lastMessage:"",
      lastTime:   "Ahora",
      memberCount:allMembers.length,
    });

  } catch (err) {
    console.error("[POST /chats]", err);
    res.status(500).json({ message: "Error al crear el chat." });
  }
});

// ═══════════════════════════════════════════════════════════
// RUTAS FIJAS — antes de /:id
// ═══════════════════════════════════════════════════════════

// GET /chats/suggestions
router.get("/suggestions", async (req, res) => {
  try {
    const userId = req.user.id;

    const myChats = await Chat.find({ type: "p2p", participants: userId })
      .select("participants").lean();

    const alreadyChatting = new Set(
      myChats.flatMap(c => c.participants.map(p => String(p)))
    );
    alreadyChatting.add(String(userId));

    // Excluir bloqueados
    const blocks = await Block.find({ $or: [{ blocker: userId }, { blocked: userId }] })
      .select("blocker blocked").lean();
    const blockedIds = blocks.map(b =>
      String(b.blocker) === String(userId) ? String(b.blocked) : String(b.blocker)
    );
    blockedIds.forEach(id => alreadyChatting.add(id));

    const me         = await User.findById(userId).select("contacts").lean();
    const contactIds = (me?.contacts ?? []).map(c => String(c.userId));
    let suggestions  = [];

    if (contactIds.length > 0) {
      const contactUsers = await User.find({
        _id:      { $in: contactIds, $nin: [...alreadyChatting] },
        isActive: { $ne: false },
      }).select("username avatarUrl role").limit(5).lean();

      suggestions = contactUsers.map(u => ({
        _id: String(u._id), username: u.username,
        avatarUrl: u.avatarUrl ?? null, role: u.role,
        source: "contacto", mutualCount: 0,
      }));
    }

    if (suggestions.length < 5) {
      const exclude = new Set([...alreadyChatting, ...suggestions.map(s => s._id)]);
      const others  = await User.find({
        _id: { $nin: [...exclude] }, isActive: { $ne: false },
      }).select("username avatarUrl role").limit(5 - suggestions.length).lean();

      others.forEach(u => suggestions.push({
        _id: String(u._id), username: u.username,
        avatarUrl: u.avatarUrl ?? null, role: u.role,
        source: "nakama", mutualCount: 0,
      }));
    }

    res.json(suggestions);
  } catch (err) {
    console.error("[GET /chats/suggestions]", err);
    res.json([]);
  }
});

// GET /chats/search-users?q=
router.get("/search-users", async (req, res) => {
  try {
    const { q = "", source: _s = "all" } = req.query;
    const userId = req.user.id;
    if (String(q).length < 2) return res.json([]);

    // Excluir bloqueados en búsqueda
    const blocks = await Block.find({ $or: [{ blocker: userId }, { blocked: userId }] })
      .select("blocker blocked").lean();
    const blockedIds = blocks.map(b =>
      String(b.blocker) === String(userId) ? String(b.blocked) : String(b.blocker)
    );

    const regex = new RegExp(String(q).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    const users = await User.find({
      _id:      { $ne: userId, $nin: blockedIds },
      username: regex,
      isActive: { $ne: false },
    }).select("username avatarUrl role").limit(20).lean();

    const me         = await User.findById(userId).select("contacts").lean();
    const contactSet = new Set((me?.contacts ?? []).map(c => String(c.userId)));

    res.json(users.map(u => ({
      _id:       String(u._id),
      username:  u.username,
      avatarUrl: u.avatarUrl ?? null,
      role:      u.role,
      source:    contactSet.has(String(u._id)) ? "contacto" : "nakama",
      isContact: contactSet.has(String(u._id)),
    })));
  } catch (err) {
    console.error("[GET /chats/search-users]", err);
    res.json([]);
  }
});

// GET /chats/social-search?platform=&q=
router.get("/social-search", async (req, res) => {
  try {
    const { platform, q } = req.query;
    const userId = req.user.id;
    if (!platform || !q || String(q).length < 2) return res.json([]);

    const allowed = ["instagram", "tiktok", "facebook"];
    if (!allowed.includes(String(platform))) {
      return res.status(400).json({ message: "Plataforma no soportada." });
    }

    const cleanQ     = String(q).replace(/^@/, "").trim();
    const regex      = new RegExp(cleanQ.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    const socialField= `socialLinks.${platform}`;

    const users = await User.find({
      _id: { $ne: userId }, isActive: { $ne: false },
      $or: [{ [socialField]: regex }, { username: regex }],
    }).select("username avatarUrl role socialLinks").limit(15).lean();

    if (users.length === 0) {
      return res.json([{
        nakamaId: null, username: cleanQ, displayName: cleanQ,
        avatarUrl: null, platform: String(platform),
        inNakama: false, isContact: false,
        profileUrl: buildProfileUrl(String(platform), cleanQ),
      }]);
    }

    const me         = await User.findById(userId).select("contacts").lean();
    const contactSet = new Set((me?.contacts ?? []).map(c => String(c.userId)));

    res.json(users.map(u => ({
      nakamaId:    String(u._id),
      username:    u.socialLinks?.[platform] || u.username,
      displayName: u.username,
      avatarUrl:   u.avatarUrl ?? null,
      platform:    String(platform),
      inNakama:    true,
      isContact:   contactSet.has(String(u._id)),
      profileUrl:  buildProfileUrl(String(platform), u.socialLinks?.[platform] || u.username),
    })));
  } catch (err) {
    console.error("[GET /chats/social-search]", err);
    res.status(500).json({ message: "Error al buscar en redes sociales." });
  }
});

// GET /chats/contacts
router.get("/contacts", async (req, res) => {
  try {
    const me = await User.findById(req.user.id).select("contacts").lean();
    if (!me?.contacts?.length) return res.json([]);

    const ids   = me.contacts.map(c => c.userId).filter(Boolean);
    const users = await User.find({ _id: { $in: ids } }).select("username avatarUrl role").lean();
    const map   = {};
    users.forEach(u => { map[String(u._id)] = u; });

    res.json(
      me.contacts.map(c => {
        const u = map[String(c.userId)];
        if (!u) return null;
        return {
          userId:   String(u._id), username: u.username,
          avatarUrl:u.avatarUrl ?? null, role: u.role,
          alias:    c.alias || "", notes: c.notes || "",
          source:   c.source || "nakama", savedAt: c.savedAt,
        };
      }).filter(Boolean)
    );
  } catch (err) {
    console.error("[GET /chats/contacts]", err);
    res.status(500).json({ message: "Error al obtener contactos." });
  }
});

// POST /chats/contacts
router.post("/contacts", async (req, res) => {
  try {
    const { targetUserId, alias = "", notes = "", source = "nakama" } = req.body;
    if (!targetUserId) return res.status(400).json({ message: "Falta el ID del usuario." });

    const target = await User.findById(targetUserId).select("username avatarUrl").lean();
    if (!target)  return res.status(404).json({ message: "Usuario no encontrado." });

    const me = await User.findById(req.user.id);
    if (!me.contacts) me.contacts = [];

    const already = me.contacts.find(c => String(c.userId) === String(targetUserId));
    if (already) {
      if (alias)  already.alias  = alias;
      if (notes)  already.notes  = notes;
      if (source) already.source = source;
      await me.save();
      return res.json({ message: "Contacto actualizado.", username: target.username, avatarUrl: target.avatarUrl });
    }

    me.contacts.push({ userId: targetUserId, alias, notes, source, savedAt: new Date() });
    await me.save();
    res.status(201).json({ message: "¡Contacto guardado! ✓", username: target.username, avatarUrl: target.avatarUrl });
  } catch (err) {
    console.error("[POST /chats/contacts]", err);
    res.status(500).json({ message: "Error al guardar contacto." });
  }
});

// DELETE /chats/contacts/:userId
router.delete("/contacts/:userId", async (req, res) => {
  try {
    await User.updateOne(
      { _id: req.user.id },
      { $pull: { contacts: { userId: req.params.userId } } }
    );
    res.json({ message: "Contacto eliminado." });
  } catch (err) {
    console.error("[DELETE /chats/contacts]", err);
    res.status(500).json({ message: "Error al eliminar contacto." });
  }
});

// ═══════════════════════════════════════════════════════════
// BLOQUEAR / DESBLOQUEAR
// ═══════════════════════════════════════════════════════════

// POST /chats/block
router.post("/block", async (req, res) => {
  try {
    const { targetUserId } = req.body;
    const userId = req.user.id;

    if (!targetUserId) return res.status(400).json({ message: "Falta el ID del usuario." });
    if (String(targetUserId) === String(userId))
      return res.status(400).json({ message: "No podés bloquearte a vos mismo." });

    const target = await User.findById(targetUserId).select("username").lean();
    if (!target) return res.status(404).json({ message: "Usuario no encontrado." });

    // upsert — si ya existe no tira error
    await Block.findOneAndUpdate(
      { blocker: userId, blocked: targetUserId },
      { blocker: userId, blocked: targetUserId },
      { upsert: true, new: true }
    );

    res.json({ message: `Bloqueaste a @${target.username}.`, blocked: true });
  } catch (err) {
    console.error("[POST /chats/block]", err);
    res.status(500).json({ message: "Error al bloquear usuario." });
  }
});

// DELETE /chats/block/:targetUserId
router.delete("/block/:targetUserId", async (req, res) => {
  try {
    const { targetUserId } = req.params;
    const userId = req.user.id;

    const target = await User.findById(targetUserId).select("username").lean();
    await Block.deleteOne({ blocker: userId, blocked: targetUserId });

    res.json({ message: `Desbloqueaste a @${target?.username ?? "usuario"}.`, blocked: false });
  } catch (err) {
    console.error("[DELETE /chats/block]", err);
    res.status(500).json({ message: "Error al desbloquear usuario." });
  }
});

// GET /chats/block — lista de usuarios bloqueados
router.get("/block", async (req, res) => {
  try {
    const userId = req.user.id;
    const blocks = await Block.find({ blocker: userId }).select("blocked createdAt").lean();
    const ids    = blocks.map(b => b.blocked);
    const users  = await User.find({ _id: { $in: ids } }).select("username avatarUrl").lean();
    const map    = {};
    users.forEach(u => { map[String(u._id)] = u; });

    res.json(blocks.map(b => ({
      userId:    String(b.blocked),
      username:  map[String(b.blocked)]?.username ?? "Usuario",
      avatarUrl: map[String(b.blocked)]?.avatarUrl ?? null,
      blockedAt: b.createdAt,
    })));
  } catch (err) {
    console.error("[GET /chats/block]", err);
    res.status(500).json({ message: "Error al obtener bloqueados." });
  }
});

// ═══════════════════════════════════════════════════════════
// REPORTAR
// ═══════════════════════════════════════════════════════════

// POST /chats/report
router.post("/report", async (req, res) => {
  try {
    const { targetUserId, chatId, messageId, reason, details = "" } = req.body;
    const userId = req.user.id;

    const VALID_REASONS = ["spam","acoso","contenido_inapropiado","violencia","odio","desinformacion","otro"];
    if (!targetUserId) return res.status(400).json({ message: "Falta el ID del usuario." });
    if (!reason || !VALID_REASONS.includes(reason))
      return res.status(400).json({ message: "Motivo de reporte inválido." });
    if (String(targetUserId) === String(userId))
      return res.status(400).json({ message: "No podés reportarte a vos mismo." });

    const target = await User.findById(targetUserId).select("username").lean();
    if (!target) return res.status(404).json({ message: "Usuario no encontrado." });

    // Evitar reportes duplicados en menos de 24h para el mismo motivo
    const recent = await Report.findOne({
      reporter:  userId,
      reported:  targetUserId,
      reason,
      createdAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
    });
    if (recent) {
      return res.status(429).json({ message: "Ya reportaste a este usuario por este motivo recientemente." });
    }

    await Report.create({
      reporter:  userId,
      reported:  targetUserId,
      chatId:    chatId  || null,
      messageId: messageId || null,
      reason,
      details:   details.slice(0, 500),
    });

    res.status(201).json({
      message: `Reporte enviado. Revisaremos la situación con @${target.username}.`,
      reported: true,
    });
  } catch (err) {
    console.error("[POST /chats/report]", err);
    res.status(500).json({ message: "Error al enviar el reporte." });
  }
});

// ═══════════════════════════════════════════════════════════
// MENSAJES (persistencia real)
// /:id siempre al final
// ═══════════════════════════════════════════════════════════

// GET /chats/:id/messages?page=1&limit=50
router.get("/:id/messages", async (req, res) => {
  try {
    const { page = 1, limit = 50 } = req.query;
    const userId = req.user.id;

    const chat = await Chat.findOne({
      _id: req.params.id,
      $or: [{ participants: userId }, { "members.userId": userId }],
    })
      .select("messages participants")
      .populate("messages.sender", "username avatarUrl")
      .lean();

    if (!chat) return res.status(404).json({ message: "Chat no encontrado." });

    const all  = (chat.messages ?? []).filter(m => !m.deletedFor?.includes(userId));
    const skip = Math.max(0, all.length - Number(page) * Number(limit));
    const msgs = all.slice(skip, skip + Number(limit));

    res.json(msgs.map(m => ({
      id:         String(m._id),
      sender: {
        _id:       String(m.sender?._id ?? m.sender),
        username:  m.sender?.username ?? "Usuario",
        avatarUrl: m.sender?.avatarUrl ?? null,
        role:      m.sender?.role ?? "user",
      },
      roomType:   chat.participants?.length === 2 ? "private" : "group",
      roomId:     String(chat._id),
      text:       m.deleted ? "" : m.text,
      attachment: m.attachment ?? null,
      replyTo:    m.replyTo ?? null,
      reactions:  m.reactions ?? [],
      status:     m.status ?? "sent",
      readAt:     m.readAt ?? null,
      isSystem:   m.isSystem,
      deleted:    m.deleted,
      createdAt:  m.createdAt,
    })));
  } catch (err) {
    console.error("[GET /:id/messages]", err);
    res.status(500).json({ message: "Error al obtener mensajes." });
  }
});

// POST /chats/:id/messages (REST fallback — socket es el canal principal)
router.post("/:id/messages", async (req, res) => {
  try {
    const { text = "", type = "text", fileUrl } = req.body;
    const userId = req.user.id;
    const user   = await User.findById(userId).select("username avatarUrl").lean();

    const chat = await Chat.findOne({
      _id: req.params.id,
      $or: [{ participants: userId }, { "members.userId": userId }],
    });
    if (!chat) return res.status(404).json({ message: "Chat no encontrado." });

    // Verificar bloqueo en p2p
    if (chat.type === "p2p") {
      const otherId = chat.participants.find(p => String(p) !== String(userId));
      if (otherId) {
        const block = await Block.findOne({
          $or: [
            { blocker: userId, blocked: otherId },
            { blocker: otherId, blocked: userId },
          ],
        });
        if (block) return res.status(403).json({ message: "No podés enviar mensajes a este usuario." });
      }
    }

    const newMsg = {
      sender:      userId,
      text:        text,
      attachment:  fileUrl ? { type, url: fileUrl } : null,
      status:      "sent",
      isSystem:    false,
      deleted:     false,
      reactions:   [],
    };

    chat.messages.push(newMsg);
    chat.lastMessage  = text.slice(0, 80) || "[archivo]";
    chat.lastActivity = new Date();
    await chat.save();

    const saved = chat.messages[chat.messages.length - 1];
    res.status(201).json({
      id:        String(saved._id),
      sender: {
        _id:       String(userId),
        username:  user.username,
        avatarUrl: user.avatarUrl ?? null,
        role:      "user",
      },
      text:      saved.text,
      status:    saved.status,
      createdAt: saved.createdAt,
    });
  } catch (err) {
    console.error("[POST /:id/messages]", err);
    res.status(500).json({ message: "Error al enviar mensaje." });
  }
});

module.exports = router;