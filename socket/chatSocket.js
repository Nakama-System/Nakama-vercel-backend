// ═══════════════════════════════════════════════════════════
// socket/chatSocket.js — Nakama
// Maneja mensajes en tiempo real + persiste en MongoDB
// FIX: avatares correctos, bloqueos, reportes
// ═══════════════════════════════════════════════════════════

const Chat           = require("../models/Chat");
const User           = require("../models/User");
const { Block }      = require("../models/BlockReport");
const jwt            = require("jsonwebtoken");

// userId → Set<socketId>
const onlineUsers = new Map();

function getRoomKey(roomType, roomId) {
  return `${roomType}:${roomId}`;
}

module.exports = function initChatSocket(io) {

  // ── Middleware auth ─────────────────────────────────────
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      if (!token) return next(new Error("No autenticado"));

      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const user    = await User.findById(decoded.id ?? decoded._id)
        .select("_id username avatarUrl role").lean();
      if (!user) return next(new Error("Usuario no encontrado"));

      socket.userId    = String(user._id);
      socket.username  = user.username;
      socket.avatarUrl = user.avatarUrl ?? null;
      socket.userRole  = user.role ?? "user";
      next();
    } catch (err) {
      next(new Error("Token inválido"));
    }
  });

  io.on("connection", (socket) => {
    const uid = socket.userId;

    // Registrar online
    if (!onlineUsers.has(uid)) onlineUsers.set(uid, new Set());
    onlineUsers.get(uid).add(socket.id);
    socket.broadcast.emit("user:online", { userId: uid });

    // ── room:join ────────────────────────────────────────
    socket.on("room:join", async ({ roomType, roomId }, ack) => {
      try {
        const chat = await Chat.findOne({
          _id: roomId,
          $or: [{ participants: uid }, { "members.userId": uid }],
        })
          .select("messages participants")
          .populate("messages.sender", "username avatarUrl role")
          .lean();

        if (!chat) return ack({ ok: false, error: "Chat no encontrado" });

        const key = getRoomKey(roomType, roomId);
        socket.join(key);

        const messages = (chat.messages ?? [])
          .filter(m => !m.deletedFor?.some(id => String(id) === uid))
          .slice(-50)  // últimos 50
          .map(m => formatMsg(m, roomType, roomId));

        ack({ ok: true, data: { messages } });

        // Marcar entregados
        await Chat.updateMany(
          { _id: roomId, "messages.status": "sent", "messages.sender": { $ne: uid } },
          { $set: { "messages.$[msg].status": "delivered" } },
          { arrayFilters: [{ "msg.status": "sent", "msg.sender": { $ne: uid } }] }
        );
      } catch (err) {
        console.error("[room:join]", err);
        ack({ ok: false, error: "Error al unirse a la sala" });
      }
    });

    // ── message:send ─────────────────────────────────────
    socket.on("message:send", async ({ roomType, roomId, text, replyTo }, ack) => {
      try {
        if (!text?.trim()) return ack({ ok: false, error: "Mensaje vacío" });

        const chat = await Chat.findOne({
          _id: roomId,
          $or: [{ participants: uid }, { "members.userId": uid }],
        });
        if (!chat) return ack({ ok: false, error: "Chat no encontrado" });

        // Verificar bloqueo en p2p
        if (chat.type === "p2p") {
          const otherId = chat.participants.find(p => String(p) !== uid);
          if (otherId) {
            const block = await Block.findOne({
              $or: [
                { blocker: uid,     blocked: otherId },
                { blocker: otherId, blocked: uid     },
              ],
            });
            if (block) return ack({ ok: false, error: "No podés enviar mensajes a este usuario" });
          }
        }

        const newMsg = {
          sender:    uid,
          text:      text.trim(),
          replyTo:   replyTo || null,
          status:    "sent",
          isSystem:  false,
          deleted:   false,
          reactions: [],
        };

        chat.messages.push(newMsg);
        chat.lastMessage  = text.trim().slice(0, 80);
        chat.lastActivity = new Date();
        await chat.save();

        const saved     = chat.messages[chat.messages.length - 1];
        const populated = await User.findById(uid).select("username avatarUrl role").lean();

        const msgOut = {
          id:         String(saved._id),
          sender: {
            _id:       String(uid),
            username:  socket.username,
            avatarUrl: socket.avatarUrl,
            role:      socket.userRole,
          },
          roomType,
          roomId:     String(roomId),
          text:       saved.text,
          attachment: null,
          replyTo:    null,
          reactions:  [],
          status:     "sent",
          readAt:     null,
          isSystem:   false,
          deleted:    false,
          createdAt:  saved.createdAt.toISOString(),
        };

        // Confirmar al remitente
        ack({ ok: true, data: { message: msgOut } });

        // Broadcast al resto de la sala
        const key = getRoomKey(roomType, roomId);
        socket.to(key).emit("message:new", msgOut);

        // Actualizar estado a "delivered" si el otro está online
        if (chat.type === "p2p") {
          const otherId = String(chat.participants.find(p => String(p) !== uid));
          if (onlineUsers.has(otherId) && onlineUsers.get(otherId).size > 0) {
            await Chat.updateOne(
              { _id: roomId, "messages._id": saved._id },
              { $set: { "messages.$.status": "delivered" } }
            );
            socket.emit("message:delivered", { messageId: String(saved._id) });
          }
        }

      } catch (err) {
        console.error("[message:send]", err);
        ack({ ok: false, error: "Error al enviar mensaje" });
      }
    });

    // ── message:read ──────────────────────────────────────
    socket.on("message:read", async ({ roomType, roomId, lastMessageId }) => {
      try {
        await Chat.updateMany(
          { _id: roomId, "messages.status": { $ne: "read" }, "messages.sender": { $ne: uid } },
          {
            $set: {
              "messages.$[msg].status": "read",
              "messages.$[msg].readAt": new Date(),
            }
          },
          { arrayFilters: [{ "msg.status": { $ne: "read" }, "msg.sender": { $ne: uid } }] }
        );

        const key = getRoomKey(roomType, roomId);
        socket.to(key).emit("message:read-ack", {
          readBy:        uid,
          lastMessageId,
        });
      } catch (err) {
        console.error("[message:read]", err);
      }
    });

    // ── typing ────────────────────────────────────────────
    socket.on("typing:start", ({ roomType, roomId }) => {
      const key = getRoomKey(roomType, roomId);
      socket.to(key).emit("typing:update", { userId: uid, isTyping: true });
    });
    socket.on("typing:stop", ({ roomType, roomId }) => {
      const key = getRoomKey(roomType, roomId);
      socket.to(key).emit("typing:update", { userId: uid, isTyping: false });
    });

    // ── message:delete ────────────────────────────────────
    socket.on("message:delete", async ({ roomType, roomId, messageId, forAll }, ack) => {
      try {
        const chat = await Chat.findOne({
          _id: roomId,
          $or: [{ participants: uid }, { "members.userId": uid }],
        });
        if (!chat) return ack?.({ ok: false, error: "Chat no encontrado" });

        const msg = chat.messages.id(messageId);
        if (!msg) return ack?.({ ok: false, error: "Mensaje no encontrado" });

        const isMine     = String(msg.sender) === uid;
        const isAdmin    = socket.userRole === "admin" || socket.userRole === "superadmin";
        const canForAll  = isMine || isAdmin;

        if (forAll && canForAll) {
          msg.deleted = true;
          msg.text    = "";
        } else {
          // Solo para mí
          if (!msg.deletedFor) msg.deletedFor = [];
          msg.deletedFor.push(uid);
        }

        await chat.save();

        const key = getRoomKey(roomType, roomId);
        io.to(key).emit("message:deleted", {
          messageId,
          forAll: forAll && canForAll,
          deletedBy: uid,
        });
        ack?.({ ok: true });
      } catch (err) {
        console.error("[message:delete]", err);
        ack?.({ ok: false, error: "Error al eliminar" });
      }
    });

    // ── message:reaction ─────────────────────────────────
    socket.on("message:react", async ({ roomType, roomId, messageId, emoji }, ack) => {
      try {
        const chat = await Chat.findOne({ _id: roomId });
        if (!chat) return ack?.({ ok: false });

        const msg = chat.messages.id(messageId);
        if (!msg) return ack?.({ ok: false });

        let reaction = msg.reactions.find(r => r.emoji === emoji);
        if (reaction) {
          const idx = reaction.userIds.findIndex(id => String(id) === uid);
          if (idx >= 0) reaction.userIds.splice(idx, 1);  // toggle off
          else          reaction.userIds.push(uid);        // toggle on
          if (reaction.userIds.length === 0)
            msg.reactions = msg.reactions.filter(r => r.emoji !== emoji);
        } else {
          msg.reactions.push({ emoji, userIds: [uid] });
        }

        await chat.save();

        const key = getRoomKey(roomType, roomId);
        io.to(key).emit("message:reaction-updated", {
          messageId,
          reactions: msg.reactions,
        });
        ack?.({ ok: true, data: { reactions: msg.reactions } });
      } catch (err) {
        console.error("[message:react]", err);
        ack?.({ ok: false });
      }
    });

    // ── disconnect ────────────────────────────────────────
    socket.on("disconnect", () => {
      const sockets = onlineUsers.get(uid);
      if (sockets) {
        sockets.delete(socket.id);
        if (sockets.size === 0) {
          onlineUsers.delete(uid);
          socket.broadcast.emit("user:offline", { userId: uid });
        }
      }
    });
  });
};

// ─── Helper ───────────────────────────────────────────────
function formatMsg(m, roomType, roomId) {
  const sender = m.sender ?? {};
  return {
    id:         String(m._id),
    sender: {
      _id:       String(sender._id ?? sender),
      username:  sender.username  ?? "Usuario",
      avatarUrl: sender.avatarUrl ?? null,
      role:      sender.role      ?? "user",
    },
    roomType,
    roomId:     String(roomId),
    text:       m.deleted ? "" : (m.text ?? ""),
    attachment: m.attachment ?? null,
    replyTo:    m.replyTo   ?? null,
    reactions:  m.reactions ?? [],
    status:     m.status    ?? "sent",
    readAt:     m.readAt    ?? null,
    isSystem:   m.isSystem  ?? false,
    deleted:    m.deleted   ?? false,
    createdAt:  m.createdAt?.toISOString?.() ?? new Date().toISOString(),
  };
}