// ═══════════════════════════════════════════════════════════
// socket/SocketCommunity.js — Nakama
// ✅ FIXES:
//   1. Verificación de membresía robusta (soporta {userId}, {_id}, o string)
//   2. Evento ephemeral corregido: "community:ephemeral_new"
// ═══════════════════════════════════════════════════════════

const mongoose                  = require("mongoose");
const Message                   = require("../models/Message");
const EphemeralMessageCommunity = require("../models/EphemeralmessageComunnity");

// ── Helper: normaliza un member a string de id ──────────────
function getMemberId(m) {
  if (!m) return null;
  if (typeof m === "string") return m;
  // ObjectId directo
  if (m instanceof mongoose.Types.ObjectId) return String(m);
  // { userId: ... } — formato más común en comunidades
  if (m.userId) return String(m.userId);
  // { _id: ... }
  if (m._id) return String(m._id);
  // { user: ... }
  if (m.user) return String(m.user);
  // último recurso: toString del objeto
  return String(m);
}

// ── Helper: ¿el userId es miembro o dueño de la comunidad? ──
function esMiembroDeComunidad(comunidad, userId) {
  const uid = String(userId);
  if (String(comunidad.owner ?? comunidad.creatorId ?? "") === uid) return true;
  if (!Array.isArray(comunidad.members)) return false;
  return comunidad.members.some((m) => getMemberId(m) === uid);
}

// ── Helper: ¿el usuario es owner o admin de la comunidad? ──
async function esComunidadAdmin(userId, communityId) {
  try {
    const Community = require("../models/Community");
    const comunidad = await Community.findById(communityId).lean();
    if (!comunidad) return false;
    const uid = String(userId);
    if (String(comunidad.owner ?? comunidad.creatorId ?? "") === uid) return true;
    if (Array.isArray(comunidad.admins) && comunidad.admins.some((a) => String(a) === uid)) return true;
    // También verificar rol dentro de members
    if (Array.isArray(comunidad.members)) {
      const member = comunidad.members.find((m) => getMemberId(m) === uid);
      if (member && member.role === "admin") return true;
    }
    return false;
  } catch {
    return false;
  }
}

// ─────────────────────────────────────────────────────────────
// registerCommunityHandlers(socket, io, onlineUsers)
// ─────────────────────────────────────────────────────────────
function registerCommunityHandlers(socket, io, onlineUsers) {

  if (!socket || typeof socket.on !== "function") {
    console.warn("[community] Argumento 'socket' inválido. Saltando registro de handlers.");
    return;
  }

  if (!socket.user) {
    console.warn("[community] socket.user es undefined. Saltando registro de handlers.");
    if (typeof socket.disconnect === "function") socket.disconnect(true);
    return;
  }

  console.log(`✅ [community] Registrando handlers para ${socket.user.username}`);

  const userId = String(socket.user._id ?? socket.user.id);

  // ── community:join ────────────────────────────────────────
  socket.on("community:join", async ({ roomId } = {}, ack) => {
    if (!roomId) return ack?.({ ok: false, error: "roomId es requerido" });

    try {
      const Community = require("../models/Community");
      const comunidad = await Community.findById(roomId).lean();
      if (!comunidad) return ack?.({ ok: false, error: "Comunidad no encontrada" });

      // ✅ FIX: verificación robusta de membresía
      const esMiembro = esMiembroDeComunidad(comunidad, userId);

      if (!esMiembro) {
        console.warn(`[community:join] Usuario ${userId} NO es miembro de ${roomId}. Members sample:`,
          (comunidad.members ?? []).slice(0, 3).map((m) => ({ raw: m, id: getMemberId(m) }))
        );
        return ack?.({ ok: false, error: "No sos miembro de esta comunidad" });
      }

      socket.join(`community:${roomId}`);
      console.log(`[community:join] ${socket.user.username} entró a community:${roomId}`);

      const mensajes = await Message.find({
        roomType: "community",
        roomId:   new mongoose.Types.ObjectId(String(roomId)),
      })
        .sort({ createdAt: -1 })
        .limit(50)
        .populate("sender", "username avatarUrl profileVideo role")
        .lean();

      const mensajesOrdenados = mensajes.reverse().map((m) => ({
        id:         String(m._id),
        sender:     m.sender,
        roomType:   "community",
        roomId:     String(m.roomId),
        text:       m.deleted ? "" : (m.text ?? ""),
        attachment: m.attachment ?? null,
        replyTo:    m.replyTo   ?? null,
        reactions:  m.reactions ?? [],
        status:     m.status    ?? "sent",
        readAt:     m.readAt    ?? null,
        isSystem:   m.isSystem  ?? false,
        deleted:    m.deleted   ?? false,
        edited:     m.edited    ?? false,
        createdAt:  m.createdAt,
      }));

      // ✅ FIX: efímeros pendientes con evento correcto "community:ephemeral_new"
      const efimerosPendientes = await EphemeralMessageCommunity.find({
        roomId:    new mongoose.Types.ObjectId(String(roomId)),
        destroyed: false,
        recipients: {
          $elemMatch: {
            userId: new mongoose.Types.ObjectId(userId),
            viewed: false,
          },
        },
        $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }],
      })
        .populate("senderId", "username avatarUrl profileVideo")
        .lean();

      for (const eph of efimerosPendientes) {
        // ✅ NOMBRE CORRECTO: community:ephemeral_new (no communityEphemeral:new)
        socket.emit("community:ephemeral_new", {
          _id:          String(eph._id),
          roomId:       String(eph.roomId),
          roomType:     "community",
          senderId:     String(eph.senderId?._id ?? eph.senderId),
          senderName:   eph.senderId?.username  || "Anónimo",
          senderAvatar: eph.senderId?.avatarUrl || null,
          senderVideo:  eph.senderId?.profileVideo?.url || null,
          thumbnailUrl: eph.thumbnailUrl,
          caption:      eph.caption,
          config:       eph.config,
          createdAt:    eph.createdAt,
        });
      }

      ack?.({ ok: true, data: { messages: mensajesOrdenados, communityName: comunidad.name } });
    } catch (err) {
      console.error("[community:join] Error:", err);
      ack?.({ ok: false, error: "Error interno al unirse a la comunidad" });
    }
  });

  // ── community:message:send ───────────────────────────────
  socket.on("community:message:send", async ({ roomId, text, attachment, replyTo } = {}, ack) => {
    if (!roomId) return ack?.({ ok: false, error: "roomId es requerido" });

    try {
      const Community = require("../models/Community");
      const comunidad = await Community.findById(roomId).lean();
      if (!comunidad) return ack?.({ ok: false, error: "Comunidad no encontrada" });

      // ✅ FIX: misma verificación robusta
      const esMiembro = esMiembroDeComunidad(comunidad, userId);
      if (!esMiembro) return ack?.({ ok: false, error: "No sos miembro de esta comunidad" });

      const mensaje = await Message.create({
        sender:     new mongoose.Types.ObjectId(userId),
        roomType:   "community",
        roomId:     new mongoose.Types.ObjectId(String(roomId)),
        text:       text || "",
        attachment: attachment || null,
        replyTo:    replyTo   || null,
        reactions:  [],
        status:     "sent",
        isSystem:   false,
        deleted:    false,
      });

      await mensaje.populate("sender", "username avatarUrl profileVideo role");

      const payload = {
        id:         String(mensaje._id),
        sender:     mensaje.sender,
        roomType:   "community",
        roomId:     String(roomId),
        text:       mensaje.text,
        attachment: mensaje.attachment,
        replyTo:    mensaje.replyTo,
        reactions:  [],
        status:     "sent",
        readAt:     null,
        isSystem:   false,
        deleted:    false,
        edited:     false,
        createdAt:  mensaje.createdAt,
      };

      io.to(`community:${roomId}`).emit("community:message:new", payload);
      ack?.({ ok: true, data: { message: payload } });
    } catch (err) {
      console.error("[community:message:send] Error:", err);
      ack?.({ ok: false, error: "Error al enviar el mensaje" });
    }
  });

  // ── community:message:edit ───────────────────────────────
  socket.on("community:message:edit", async ({ roomId, messageId, text } = {}, ack) => {
    if (!roomId || !messageId) return ack?.({ ok: false, error: "Faltan parámetros" });

    try {
      const mensaje = await Message.findById(messageId);
      if (!mensaje || mensaje.deleted) return ack?.({ ok: false, error: "Mensaje no encontrado o ya eliminado" });

      const esSender = String(mensaje.sender) === userId;
      const esAdmin  = await esComunidadAdmin(userId, roomId);

      if (!esSender && !esAdmin)
        return ack?.({ ok: false, error: "No tenés permisos para editar este mensaje" });

      mensaje.text   = text || "";
      mensaje.edited = true;
      await mensaje.save();

      io.to(`community:${roomId}`).emit("community:message:edited", {
        messageId: String(messageId),
        text:      mensaje.text,
        editedBy:  userId,
      });

      ack?.({ ok: true });
    } catch (err) {
      console.error("[community:message:edit] Error:", err);
      ack?.({ ok: false, error: "Error al editar el mensaje" });
    }
  });

  // ── community:message:delete ─────────────────────────────
  socket.on("community:message:delete", async ({ roomId, messageId, forAll = false } = {}, ack) => {
    if (!roomId || !messageId) return ack?.({ ok: false, error: "Faltan parámetros" });

    try {
      const mensaje = await Message.findById(messageId);
      if (!mensaje) return ack?.({ ok: false, error: "Mensaje no encontrado" });

      const esSender = String(mensaje.sender) === userId;
      const esAdmin  = await esComunidadAdmin(userId, roomId);

      if (!esSender && !esAdmin)
        return ack?.({ ok: false, error: "No tenés permisos para eliminar este mensaje" });

      if (forAll || esAdmin) {
        mensaje.deleted    = true;
        mensaje.text       = "";
        mensaje.attachment = null;
        await mensaje.save();

        io.to(`community:${roomId}`).emit("community:message:deleted", {
          messageId: String(messageId),
          forAll:    true,
        });
      } else {
        await Message.deleteOne({ _id: messageId });
        socket.emit("community:message:deleted", {
          messageId: String(messageId),
          forAll:    false,
        });
      }

      ack?.({ ok: true });
    } catch (err) {
      console.error("[community:message:delete] Error:", err);
      ack?.({ ok: false, error: "Error al eliminar el mensaje" });
    }
  });

  // ── community:typing:start / stop ────────────────────────
  socket.on("community:typing:start", ({ roomId } = {}) => {
    if (!roomId) return;
    socket.to(`community:${roomId}`).emit("community:typing:update", {
      userId,
      username: socket.user.username,
      isTyping: true,
    });
  });

  socket.on("community:typing:stop", ({ roomId } = {}) => {
    if (!roomId) return;
    socket.to(`community:${roomId}`).emit("community:typing:update", {
      userId,
      username: socket.user.username,
      isTyping: false,
    });
  });

  // ── community:view_ephemeral ─────────────────────────────
  socket.on("community:view_ephemeral", async ({ communityId, messageId }, ack) => {
    if (!messageId) return ack?.({ ok: false, error: "messageId requerido" });

    try {
      const msg = await EphemeralMessageCommunity.findById(messageId);
      if (!msg) return ack?.({ ok: false, error: "Mensaje no encontrado" });

      const imageUrl = msg.imageUrl ?? null;
      const caption  = msg.caption  ?? "";

      if (msg.destroyed) {
        const recipient = msg.recipients.find((r) => String(r.userId) === userId);
        if (recipient?.viewed) {
          return ack?.({ ok: false, error: "Ya viste este mensaje", destroyed: true });
        }
        return ack?.({ ok: true, imageUrl, caption, destroyed: true });
      }

      const recipient = msg.recipients.find((r) => String(r.userId) === userId);
      if (recipient && !recipient.viewed) {
        recipient.viewed   = true;
        recipient.viewedAt = new Date();
      }

      const allViewed = msg.recipients.every((r) => r.viewed);
      if (msg.config?.oneTimeView || allViewed) {
        msg.destroyed   = true;
        msg.destroyedAt = new Date();
      }

      await msg.save();

      ack?.({ ok: true, imageUrl, caption, destroyed: msg.destroyed });

      try {
        io.to(`user:${String(msg.senderId)}`).emit("community:ephemeral_viewed", {
          messageId: String(msg._id),
          viewedBy:  userId,
        });
      } catch {}

      if (msg.destroyed) {
        try {
          io.to(`community:${String(msg.roomId)}`).emit("community:ephemeral_destroyed", {
            messageId: String(msg._id),
          });
        } catch {}
      }
    } catch (err) {
      console.error("[community:view_ephemeral] Error:", err.message);
      ack?.({ ok: false, error: err.message });
    }
  });

  // ── community:delete_ephemeral ───────────────────────────
  socket.on("community:delete_ephemeral", async ({ communityId, messageId }, ack) => {
    if (!messageId) return ack?.({ ok: false, error: "messageId requerido" });

    try {
      const msg = await EphemeralMessageCommunity.findById(messageId);
      if (!msg) return ack?.({ ok: false, error: "Mensaje no encontrado" });

      const isSender = String(msg.senderId) === userId;
      const isAdmin  = await esComunidadAdmin(userId, msg.roomId);

      if (!isSender && !isAdmin)
        return ack?.({ ok: false, error: "No tienes permisos para borrar este mensaje" });

      msg.destroyed   = true;
      msg.destroyedAt = new Date();
      await msg.save();

      io.to(`community:${String(msg.roomId)}`).emit("community:ephemeral_destroyed", {
        messageId: String(msg._id),
      });

      ack?.({ ok: true });
    } catch (err) {
      console.error("[community:delete_ephemeral] Error:", err.message);
      ack?.({ ok: false, error: err.message });
    }
  });

  // ── community:leave ──────────────────────────────────────
  socket.on("community:leave", ({ roomId } = {}) => {
    if (roomId) socket.leave(`community:${roomId}`);
  });
}

module.exports = registerCommunityHandlers;