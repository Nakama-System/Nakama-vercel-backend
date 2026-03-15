// ═══════════════════════════════════════════════════════════
// socket/socketServer.js — Nakama  (v4 fixed)
// ═══════════════════════════════════════════════════════════

const { Server } = require("socket.io");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const User = require("../models/User");
const Message = require("../models/Message");
const Group = require("../models/Group");
const Community = require("../models/Community");
const Contact = require("../models/Contact");
const Chat = require("../models/Chat");
const { Block } = require("../models/BlockReport");
const { uploadToCloudinary } = require("../services/cloudinaryService");
const registerCommunitySocket = require("./socketCommunity");
const registerBattleSocket = require("./socketBattle");


const JWT_SECRET = process.env.JWT_SECRET || "nakama_jwt_dev";
const onlineUsers = new Map();

// ─── Helper: normaliza el id de un miembro de comunidad ──
function getMemberId(m) {
  return String(m.userId ?? m._id ?? "");
}

// ═══════════════════════════════════════════════════════════
function initSocket(httpServer) {
  const io = new Server(httpServer, {
    cors: {
      origin: "https://nakama-bacend-render.onrender.com/",
      credentials: true,
      methods: ["GET", "POST"],
    },
    maxHttpBufferSize: 20e6,
  });

  // ── Auth middleware ─────────────────────────────────────
  io.use(async (socket, next) => {
    try {
      const token =
        socket.handshake.auth?.token ||
        socket.handshake.headers?.authorization?.split(" ")[1];
      if (!token) return next(new Error("AUTH_REQUIRED"));

      let payload;
      try {
        payload = jwt.verify(token, JWT_SECRET);
      } catch {
        return next(new Error("TOKEN_INVALID"));
      }

      const user = await User.findById(payload.id ?? payload._id)
        .select("-password")
        .lean();
      if (!user || !user.isActive || user.isBanned)
        return next(new Error("USER_FORBIDDEN"));

      socket.user = {
        id: user._id.toString(),
        _id: user._id,
        username: user.username,
        role: user.role,
        avatarUrl: user.avatarUrl ?? null,
      };
      next();
    } catch (err) {
      next(new Error("AUTH_ERROR"));
    }
  });

  // ── Connection ──────────────────────────────────────────
  io.on("connection", async (socket) => {
    const userId = socket.user.id;
    const username = socket.user.username;

    if (!onlineUsers.has(userId)) onlineUsers.set(userId, new Set());
    onlineUsers.get(userId).add(socket.id);

    await User.findByIdAndUpdate(userId, {
      isOnline: true,
      lastSeenAt: new Date(),
    }).catch(() => {});
    await broadcastPresence(io, socket, "online");

    socket.join(`user:${userId}`);
    socket.join(`user_${userId}`);
    await joinUserRooms(socket);
    console.log(`🟢 [socket] ${username} conectado (${socket.id})`);
    

    // ── Community module (delete/edit/media/ephemeral) ────
    registerCommunitySocket(socket, io, onlineUsers);
    registerBattleSocket(socket, io);
    // ── room:join ─────────────────────────────────────────
    socket.on("room:join", async ({ roomType, roomId }, ack) => {
      try {
        socket.join(`${roomType}:${roomId}`);
        let messages = [];

        if (roomType === "private") {
          const chat = await Chat.findOne({ _id: roomId, participants: userId })
            .select("messages participants")
            .populate("messages.sender", "username avatarUrl role")
            .lean();
          if (!chat) return ack?.({ ok: false, error: "Chat no encontrado" });

          messages = (chat.messages ?? [])
            .filter((m) => !m.deletedFor?.some((id) => String(id) === userId))
            .slice(-50)
            .map((m) => serializeChatMsg(m, roomType, roomId));

          await markChatRead(roomId, userId);
        } else if (roomType === "community") {
          const community = await Community.findById(roomId)
            .select("members messagingOpen")
            .lean();
          if (!community)
            return ack?.({ ok: false, error: "Comunidad no encontrada" });

          const memberMap = {};
          (community.members ?? []).forEach((m) => {
            memberMap[getMemberId(m)] = m;
          });

          const dbMsgs = await Message.find({
            roomType: "community",
            roomId: new mongoose.Types.ObjectId(String(roomId)),
            deletedForAll: { $ne: true },
          })
            .sort({ createdAt: -1 })
            .limit(50)
            .lean();

          const senderIds = [
            ...new Set(
              dbMsgs.map((m) => String(m.sender ?? "")).filter(Boolean),
            ),
          ];
          const userDocs = await User.find(
            { _id: { $in: senderIds } },
            "username avatarUrl profileVideo",
          ).lean();
          const userMap = Object.fromEntries(
            userDocs.map((u) => [String(u._id), u]),
          );

          messages = dbMsgs.reverse().map((m) => {
            const sid = String(m.sender ?? "");
            const member = memberMap[sid] ?? {};
            const user = userMap[sid] ?? {};
            const isJoin = m.isSystem && m.text?.startsWith("JOIN_EVENT:");
            return {
              id: String(m._id),
              type: isJoin ? "join_event" : "message",
              senderId: sid,
              senderName: user.username ?? member.username ?? "Usuario",
              senderAvatar: user.avatarUrl ?? member.avatarUrl ?? null,
              senderVideo:
                user.profileVideo?.url ?? member.profileVideo?.url ?? null,
              senderFrame: member.frameColor ?? "none",
              hasStar: member.hasStar ?? false,
              isAdmin: member.role === "admin",
              text: isJoin ? undefined : m.text,
              joinedUsers: isJoin
                ? (() => {
                    try {
                      return JSON.parse(m.text.replace("JOIN_EVENT:", ""))
                        .users;
                    } catch {
                      return [];
                    }
                  })()
                : undefined,
              memberNumber: isJoin
                ? (() => {
                    try {
                      return JSON.parse(m.text.replace("JOIN_EVENT:", ""))
                        .memberNumber;
                    } catch {
                      return undefined;
                    }
                  })()
                : undefined,
              roomType: "community",
              roomId: String(roomId),
              isSystem: m.isSystem ?? false,
              createdAt:
                m.createdAt?.toISOString?.() ?? new Date().toISOString(),
            };
          });
        } else {
          const room = await Group.findById(roomId);
          if (!room) return ack?.({ ok: false, error: "Sala no encontrada" });

          const dbMessages = await Message.find({
            roomType,
            roomId: new mongoose.Types.ObjectId(roomId),
            deletedForAll: { $ne: true },
            deletedFor: { $nin: [socket.user._id] },
          })
            .sort({ createdAt: -1 })
            .limit(50)
            .populate("sender", "username avatarUrl role")
            .lean();

          messages = dbMessages.reverse().map(serializeMessage);
        }

        // ── Efímeros pendientes para esta sala ──────────────
        const EphemeralMessage = require("../models/EphemeralMessage");
        const pendingEphemerals = await EphemeralMessage.find({
          roomId: new mongoose.Types.ObjectId(String(roomId)),
          destroyed: false,
          recipients: {
            $elemMatch: {
              userId: new mongoose.Types.ObjectId(String(userId)),
              viewed: false,
            },
          },
          $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }],
        })
          .populate("senderId", "username avatarUrl")
          .lean();

        pendingEphemerals.forEach((m) => {
          socket.emit("ephemeral:new", {
            _id: String(m._id),
            roomId: String(m.roomId),
            roomType: m.roomType,
            senderId: String(m.senderId?._id ?? m.senderId),
            senderName: m.senderId?.username ?? "Usuario",
            senderAvatar: m.senderId?.avatarUrl ?? "",
            thumbnailUrl: m.thumbnailUrl,
            caption: m.caption,
            config: m.config,
            createdAt: m.createdAt,
          });
        });
        // ────────────────────────────────────────────────────

        ack?.({ ok: true, data: { messages } });
      } catch (err) {
        console.error("[room:join]", err);
        ack?.({ ok: false, error: "Error al unirse a la sala" });
      }
    });
    // ── room:load-more ────────────────────────────────────
    socket.on("room:load-more", async ({ roomType, roomId, before }, ack) => {
      try {
        if (roomType === "private") {
          const chat = await Chat.findOne({ _id: roomId, participants: userId })
            .select("messages")
            .populate("messages.sender", "username avatarUrl role")
            .lean();
          if (!chat) return ack?.({ ok: false });

          const all = (chat.messages ?? []).filter(
            (m) => new Date(m.createdAt) < new Date(before),
          );
          const msgs = all
            .slice(Math.max(0, all.length - 50))
            .map((m) => serializeChatMsg(m, roomType, roomId));
          return ack?.({ ok: true, data: { messages: msgs } });
        }

        const dbMessages = await Message.find({
          roomType,
          roomId: new mongoose.Types.ObjectId(roomId),
          deletedForAll: { $ne: true },
          deletedFor: { $nin: [socket.user._id] },
          createdAt: { $lt: new Date(before) },
        })
          .sort({ createdAt: -1 })
          .limit(50)
          .populate("sender", "username avatarUrl role")
          .lean();

        ack?.({
          ok: true,
          data: { messages: dbMessages.reverse().map(serializeMessage) },
        });
      } catch (err) {
        ack?.({ ok: false });
      }
    });

    // ── message:send ──────────────────────────────────────
    socket.on("message:send", async (data, ack) => {
      try {
        const { roomType, roomId, text, attachment, replyTo } = data;

        if (!roomType || !roomId)
          return ack?.({ ok: false, error: "Datos incompletos." });
        if (!text?.trim() && !attachment)
          return ack?.({ ok: false, error: "Mensaje vacío." });

        const roomKey = `${roomType}:${roomId}`;

        // ════════════════════════════════════════════════
        // COMMUNITY
        // FIX: guarda en modelo Message con campo "sender"
        //      elimina el embedded community.messages.push()
        // ════════════════════════════════════════════════
        if (roomType === "community") {
          const community = await Community.findById(roomId);
          if (!community)
            return ack?.({ ok: false, error: "Comunidad no encontrada." });

          const isAdminMember =
            String(community.creatorId) === String(userId) ||
            community.members.find((m) => getMemberId(m) === String(userId))
              ?.role === "admin";

          // Miembros NO pueden enviar attachment (imágenes/video) — usar community:send_media
          if (attachment && !isAdminMember)
            return ack?.({
              ok: false,
              error:
                "Solo los admins pueden enviar imágenes o videos. Usá texto.",
            });

          if (!community.messagingOpen && !isAdminMember)
            return ack?.({ ok: false, error: "Mensajes deshabilitados." });

          const member = community.members.find(
            (m) =>
              getMemberId(m) === String(userId) ||
              String(m._id) === String(userId),
          );

          // Si no encontró member (usuario que acaba de unirse y no guardó aún),
          // igual puede enviar si el community no tiene restricciones
          if (!member && community.messagingOpen === false && !isAdminMember)
            return ack?.({ ok: false, error: "No sos miembro." });

          if (member?.frozen && !isAdminMember) {
            const until = member.frozenUntil;
            if (until === "permanent" || new Date(until) > new Date())
              return ack?.({ ok: false, error: "Estás congelado." });
            member.frozen = false;
            member.frozenUntil = null;
          }

          // FIX: guardar en modelo Message con "sender" (no "senderId")
          const saved = await Message.create({
            roomType: "community",
            roomId: new mongoose.Types.ObjectId(String(roomId)),
            sender: socket.user._id,
            text: text.trim(),
            isSystem: false,
          });

          if (member) member.msgCount = (member.msgCount ?? 0) + 1;
          await community.save();

          // Datos frescos del user para el payload
          const userDoc = await User.findById(
            socket.user._id,
            "username avatarUrl profileVideo",
          ).lean();

          const payload = {
            id: String(saved._id),
            type: "message",
            senderId: String(userId),
            senderName:
              userDoc?.username ?? member?.username ?? socket.user.username,
            senderAvatar: userDoc?.avatarUrl ?? member?.avatarUrl ?? null,
            senderVideo:
              userDoc?.profileVideo?.url ?? member?.profileVideo?.url ?? null,
            senderFrame: member?.frameColor ?? "none",
            hasStar: member?.hasStar ?? false,
            isAdmin: isAdminMember,
            text: saved.text,
            roomType: "community",
            roomId: String(roomId),
            isSystem: false,
            createdAt: saved.createdAt.toISOString(),
          };

          io.to(roomKey).emit("message:new", payload);
          return ack?.({
            ok: true,
            data: { message: { id: String(saved._id), ...payload } },
          });
        }

        // ════════════════════════════════════════════════
        // PRIVATE / GROUP
        // ════════════════════════════════════════════════
        const canSend = await checkSendPermission(
          socket.user,
          roomType,
          roomId,
        );
        if (!canSend.ok) return ack?.({ ok: false, error: canSend.error });

        let payload;

        if (roomType === "private") {
          const chat = await Chat.findOne({
            _id: roomId,
            participants: userId,
          });
          if (!chat) return ack?.({ ok: false, error: "Chat no encontrado." });

          chat.messages.push({
            sender: socket.user._id,
            text: text?.trim() ?? "",
            attachment: attachment ?? null,
            replyTo: replyTo ?? null,
            status: "sent",
            isSystem: false,
            deleted: false,
            reactions: [],
          });
          chat.lastMessage = text?.trim().slice(0, 80) ?? "[media]";
          chat.lastActivity = new Date();
          await chat.save();

          const saved = chat.messages[chat.messages.length - 1];
          const otherId = String(
            chat.participants.find((p) => String(p) !== userId),
          );

          await Chat.updateOne(
            { _id: roomId },
            { $inc: { [`unreadCount.${otherId}`]: 1 } },
          );

          payload = {
            id: String(saved._id),
            sender: {
              _id: userId,
              username: socket.user.username,
              avatarUrl: socket.user.avatarUrl,
              role: socket.user.role,
            },
            roomType,
            roomId: String(roomId),
            text: saved.text,
            attachment: saved.attachment ?? null,
            replyTo: null,
            reactions: [],
            status: "sent",
            readAt: null,
            isSystem: false,
            deleted: false,
            createdAt: saved.createdAt.toISOString(),
          };

          if (onlineUsers.has(otherId) && onlineUsers.get(otherId).size > 0) {
            await Chat.updateOne(
              { _id: roomId, "messages._id": saved._id },
              { $set: { "messages.$.status": "delivered" } },
            );
            payload.status = "delivered";
          }
        } else {
          // group
          const message = await Message.create({
            sender: socket.user._id,
            roomType,
            roomId: new mongoose.Types.ObjectId(roomId),
            text: text?.trim() ?? "",
            attachment: attachment ?? undefined,
            replyTo: replyTo ?? null,
            status: "sent",
          });

          await message.populate("sender", "username avatarUrl role");
          if (message.replyTo) await message.populate("replyTo", "text sender");

          if (roomType === "group") {
            await Group.findByIdAndUpdate(roomId, {
              "lastMessage.text": text?.slice(0, 80) ?? "[media]",
              "lastMessage.sender": socket.user._id,
              "lastMessage.sentAt": new Date(),
            });
          }

          payload = serializeMessage(message);
        }

        io.to(roomKey).emit("message:new", payload);
        ack?.({ ok: true, data: { message: payload } });
      } catch (err) {
        console.error("[message:send]", err);
        ack?.({ ok: false, error: "Error al enviar el mensaje." });
      }
    });

    // ── message:send-media ────────────────────────────────
    socket.on("message:send-media", async (data, ack) => {
      try {
        const { roomType, roomId, fileBuffer, mimeType, text, replyTo } = data;
        if (!fileBuffer || !mimeType)
          return ack?.({ ok: false, error: "Falta el archivo." });

        const canSend = await checkSendPermission(
          socket.user,
          roomType,
          roomId,
        );
        if (!canSend.ok) return ack?.({ ok: false, error: canSend.error });

        const isVideo = mimeType.startsWith("video/");
        const isGif = mimeType === "image/gif";
        const type = isVideo ? "video" : isGif ? "gif" : "image";
        const buffer = Buffer.isBuffer(fileBuffer)
          ? fileBuffer
          : Buffer.from(fileBuffer);

        const result = await uploadToCloudinary(buffer, {
          folder: `nakama/chat/${roomType}/${roomId}`,
          resource_type: isVideo ? "video" : "image",
          transformation: isVideo
            ? [{ quality: "auto" }]
            : [{ quality: "auto", fetch_format: "auto" }],
        });

        const attachment = {
          type,
          url: result.secure_url,
          publicId: result.public_id,
          thumbnailUrl: isVideo
            ? result.secure_url.replace(
                "/upload/",
                "/upload/so_0,w_320,h_320,c_fill/",
              )
            : "",
          width: result.width ?? 0,
          height: result.height ?? 0,
          duration: result.duration ?? 0,
          size: result.bytes ?? 0,
          mimeType,
        };

        socket.emit(
          "message:send",
          { roomType, roomId, text, attachment, replyTo },
          ack,
        );
      } catch (err) {
        console.error("[message:send-media]", err);
        ack?.({ ok: false, error: "Error al subir el archivo." });
      }
    });

    // ── message:read ──────────────────────────────────────
    socket.on("message:read", async ({ roomType, roomId, lastMessageId }) => {
      try {
        if (roomType === "private") {
          await markChatRead(roomId, userId);
          await Chat.updateOne(
            { _id: roomId },
            { $set: { [`unreadCount.${userId}`]: 0 } },
          );
        } else {
          await Message.updateMany(
            {
              roomType,
              roomId: new mongoose.Types.ObjectId(roomId),
              sender: { $ne: socket.user._id },
              status: { $ne: "read" },
            },
            { $set: { status: "read", readAt: new Date() } },
          );
        }
        io.to(`${roomType}:${roomId}`).emit("message:read-ack", {
          roomType,
          roomId,
          readBy: userId,
          readAt: new Date().toISOString(),
          lastMessageId,
        });
      } catch (err) {
        console.error("[message:read]", err);
      }
    });

    // ── message:react ─────────────────────────────────────
    socket.on(
      "message:react",
      async ({ roomType, roomId, messageId, emoji }, ack) => {
        try {
          let reactions;
          if (roomType === "private") {
            const chat = await Chat.findOne({
              _id: roomId,
              participants: userId,
            });
            if (!chat) return ack?.({ ok: false });
            const msg = chat.messages.id(messageId);
            if (!msg) return ack?.({ ok: false });
            reactions = toggleReaction(msg.reactions, emoji, socket.user._id);
            msg.reactions = reactions;
            await chat.save();
          } else {
            const message = await Message.findById(messageId);
            if (!message)
              return ack?.({ ok: false, error: "Mensaje no encontrado." });
            reactions = toggleReaction(
              message.reactions,
              emoji,
              socket.user._id,
            );
            message.reactions = reactions;
            await message.save();
          }
          io.to(`${roomType}:${roomId}`).emit("message:reaction-updated", {
            messageId,
            reactions,
          });
          ack?.({ ok: true });
        } catch (err) {
          console.error("[message:react]", err);
          ack?.({ ok: false });
        }
      },
    );

    // ── message:edit ──────────────────────────────────────
    socket.on(
      "message:edit",
      async ({ roomType, roomId, messageId, text }, ack) => {
        try {
          if (!text?.trim()) return ack?.({ ok: false, error: "Texto vacío." });
          if (roomType === "private") {
            const chat = await Chat.findOne({
              _id: roomId,
              participants: userId,
            });
            if (!chat)
              return ack?.({ ok: false, error: "Chat no encontrado." });
            const msg = chat.messages.id(messageId);
            if (!msg)
              return ack?.({ ok: false, error: "Mensaje no encontrado." });
            if (String(msg.sender) !== userId)
              return ack?.({
                ok: false,
                error: "Solo podés editar tus mensajes.",
              });
            msg.text = text.trim();
            msg.edited = true;
            await chat.save();
          } else {
            const message = await Message.findById(messageId);
            if (!message)
              return ack?.({ ok: false, error: "Mensaje no encontrado." });
            if (message.sender.toString() !== userId)
              return ack?.({ ok: false, error: "Sin permiso." });
            message.text = text.trim();
            message.edited = true;
            await message.save();
          }
          io.to(`${roomType}:${roomId}`).emit("message:edited", {
            messageId,
            text: text.trim(),
          });
          ack?.({ ok: true });
        } catch (err) {
          console.error("[message:edit]", err);
          ack?.({ ok: false, error: "Error al editar." });
        }
      },
    );

    // ── message:delete ────────────────────────────────────
    socket.on(
      "message:delete",
      async ({ roomType, roomId, messageId, forAll = false }, ack) => {
        try {
          if (roomType === "private") {
            const chat = await Chat.findOne({
              _id: roomId,
              participants: userId,
            });
            if (!chat)
              return ack?.({ ok: false, error: "Chat no encontrado." });
            const msg = chat.messages.id(messageId);
            if (!msg)
              return ack?.({ ok: false, error: "Mensaje no encontrado." });
            const isMine = String(msg.sender) === userId;
            const isAdm = ["admin", "superadmin"].includes(socket.user.role);
            if (forAll && (isMine || isAdm)) {
              msg.deleted = true;
              msg.text = "";
            } else {
              if (!msg.deletedFor) msg.deletedFor = [];
              if (!msg.deletedFor.some((id) => String(id) === userId))
                msg.deletedFor.push(socket.user._id);
            }
            await chat.save();
          } else {
            const message = await Message.findById(messageId);
            if (!message)
              return ack?.({ ok: false, error: "Mensaje no encontrado." });
            const isSender = message.sender.toString() === userId;
            if (forAll) {
              if (!isSender && socket.user.role !== "superadmin")
                return ack?.({ ok: false, error: "Sin permiso." });
              message.deletedForAll = true;
              message.text = "";
              message.attachment = undefined;
            } else {
              if (!message.deletedFor.includes(socket.user._id))
                message.deletedFor.push(socket.user._id);
            }
            await message.save();
          }
          io.to(`${roomType}:${roomId}`).emit("message:deleted", {
            messageId,
            forAll,
            deletedBy: userId,
          });
          ack?.({ ok: true });
        } catch (err) {
          console.error("[message:delete]", err);
          ack?.({ ok: false, error: "Error al eliminar." });
        }
      },
    );

    // ── typing ────────────────────────────────────────────
    socket.on("typing:start", ({ roomType, roomId }) => {
      socket
        .to(`${roomType}:${roomId}`)
        .emit("typing:update", { userId, username, roomId, isTyping: true });
    });
    socket.on("typing:stop", ({ roomType, roomId }) => {
      socket
        .to(`${roomType}:${roomId}`)
        .emit("typing:update", { userId, username, roomId, isTyping: false });
    });

    // ── group events ──────────────────────────────────────
    socket.on(
      "group:create",
      async ({ name, description, type = "group", tags = [] }, ack) => {
        try {
          const group = await Group.create({
            name,
            description,
            type,
            tags,
            owner: socket.user._id,
            members: [{ user: socket.user._id, role: "owner" }],
          });
          socket.join(`group:${group._id}`);
          await sendSystemMessage(
            io,
            "group",
            group._id.toString(),
            `${username} creó el grupo "${name}"`,
          );
          ack?.({ ok: true, group });
        } catch (err) {
          console.error("[group:create]", err);
          ack?.({ ok: false, error: err.message });
        }
      },
    );

    socket.on("group:add-member", async ({ groupId, targetUserId }, ack) => {
      try {
        const group = await Group.findById(groupId);
        if (!group) return ack?.({ ok: false, error: "Grupo no encontrado." });
        if (!["owner", "admin"].includes(group.getMemberRole(userId)))
          return ack?.({ ok: false, error: "Sin permiso." });
        if (group.isBanned(targetUserId))
          return ack?.({ ok: false, error: "Usuario baneado." });
        if (group.isMember(targetUserId))
          return ack?.({ ok: false, error: "Ya es miembro." });

        group.members.push({
          user: new mongoose.Types.ObjectId(targetUserId),
          role: "member",
        });
        await group.save();

        emitToUser(io, onlineUsers, targetUserId, "group:added", {
          groupId,
          groupName: group.name,
        });
        if (group.announceJoin) {
          const tu = await User.findById(targetUserId)
            .select("username")
            .lean();
          await sendSystemMessage(
            io,
            "group",
            groupId,
            `${tu?.username ?? "Un usuario"} se unió al grupo`,
          );
        }
        io.to(`group:${groupId}`).emit("group:member-added", {
          groupId,
          userId: targetUserId,
        });
        ack?.({ ok: true });
      } catch (err) {
        console.error("[group:add-member]", err);
        ack?.({ ok: false, error: "Error al agregar miembro." });
      }
    });

    socket.on("group:remove-member", async ({ groupId, targetUserId }, ack) => {
      try {
        const group = await Group.findById(groupId);
        if (!group) return ack?.({ ok: false, error: "Grupo no encontrado." });
        if (group.owner.toString() === targetUserId)
          return ack?.({
            ok: false,
            error: "El creador no puede ser removido.",
          });
        const myRole = group.getMemberRole(userId);
        const targetRole = group.getMemberRole(targetUserId);
        if (myRole === "admin" && targetRole !== "member")
          return ack?.({
            ok: false,
            error: "Los admins solo pueden remover miembros.",
          });
        if (!["owner", "admin"].includes(myRole) && targetUserId !== userId)
          return ack?.({ ok: false, error: "Sin permiso." });

        group.members = group.members.filter(
          (m) => m.user.toString() !== targetUserId,
        );
        await group.save();

        emitToUser(io, onlineUsers, targetUserId, "group:removed", { groupId });
        io.to(`group:${groupId}`).emit("group:member-removed", {
          groupId,
          userId: targetUserId,
        });
        await sendSystemMessage(
          io,
          "group",
          groupId,
          targetUserId === userId
            ? `${username} salió del grupo`
            : "Un miembro fue removido",
        );
        ack?.({ ok: true });
      } catch (err) {
        ack?.({ ok: false, error: "Error al remover miembro." });
      }
    });

    socket.on(
      "group:set-role",
      async ({ groupId, targetUserId, newRole }, ack) => {
        try {
          if (!["member", "admin"].includes(newRole))
            return ack?.({ ok: false, error: "Rol inválido." });
          const group = await Group.findById(groupId);
          if (!group)
            return ack?.({ ok: false, error: "Grupo no encontrado." });
          if (group.owner.toString() !== userId)
            return ack?.({
              ok: false,
              error: "Solo el creador puede cambiar roles.",
            });
          if (targetUserId === userId)
            return ack?.({
              ok: false,
              error: "No podés cambiar tu rol de owner.",
            });
          const member = group.members.find(
            (m) => m.user.toString() === targetUserId,
          );
          if (!member) return ack?.({ ok: false, error: "No es miembro." });
          member.role = newRole;
          await group.save();
          io.to(`group:${groupId}`).emit("group:role-updated", {
            groupId,
            userId: targetUserId,
            newRole,
          });
          ack?.({ ok: true });
        } catch (err) {
          ack?.({ ok: false, error: "Error al cambiar rol." });
        }
      },
    );

    socket.on(
      "group:ban",
      async ({ groupId, targetUserId, reason = "", expiresAt = null }, ack) => {
        try {
          const group = await Group.findById(groupId);
          if (!group)
            return ack?.({ ok: false, error: "Grupo no encontrado." });
          if (group.owner.toString() === targetUserId)
            return ack?.({ ok: false, error: "No podés banear al creador." });
          if (!["owner", "admin"].includes(group.getMemberRole(userId)))
            return ack?.({ ok: false, error: "Sin permiso." });

          group.members = group.members.filter(
            (m) => m.user.toString() !== targetUserId,
          );
          group.banned.push({
            user: new mongoose.Types.ObjectId(targetUserId),
            reason,
            bannedBy: socket.user._id,
            expiresAt: expiresAt ? new Date(expiresAt) : null,
          });
          await group.save();
          emitToUser(io, onlineUsers, targetUserId, "group:banned", {
            groupId,
            reason,
          });
          io.to(`group:${groupId}`).emit("group:member-banned", {
            groupId,
            userId: targetUserId,
          });
          ack?.({ ok: true });
        } catch (err) {
          ack?.({ ok: false, error: "Error al banear." });
        }
      },
    );

    socket.on("group:delete", async ({ groupId }, ack) => {
      try {
        const group = await Group.findById(groupId);
        if (!group) return ack?.({ ok: false, error: "Grupo no encontrado." });
        if (group.owner.toString() !== userId)
          return ack?.({ ok: false, error: "Solo el creador puede eliminar." });
        group.isDeleted = true;
        group.deletedAt = new Date();
        await group.save();
        io.to(`group:${groupId}`).emit("group:deleted", { groupId });
        ack?.({ ok: true });
      } catch (err) {
        ack?.({ ok: false, error: "Error al eliminar el grupo." });
      }
    });

    socket.on("group:set-visibility", async ({ groupId, visibility }, ack) => {
      try {
        const group = await Group.findById(groupId);
        if (!group) return ack?.({ ok: false, error: "Grupo no encontrado." });
        const user = await User.findById(userId).lean();
        if (!group.canToggleVisibility(user))
          return ack?.({
            ok: false,
            error: "Solo Pro o Premium pueden cambiar la visibilidad.",
          });
        group.visibility = visibility;
        await group.save();
        io.to(`group:${groupId}`).emit("group:visibility-updated", {
          groupId,
          visibility,
        });
        ack?.({ ok: true });
      } catch (err) {
        ack?.({ ok: false, error: "Error al cambiar visibilidad." });
      }
    });

    // ── contact events ────────────────────────────────────
    socket.on("contact:add", async ({ targetUserId, alias = "" }, ack) => {
      try {
        await Contact.findOneAndUpdate(
          {
            owner: socket.user._id,
            target: new mongoose.Types.ObjectId(targetUserId),
          },
          { status: "contact", alias, since: new Date() },
          { upsert: true, new: true },
        );
        ack?.({ ok: true });
      } catch (err) {
        ack?.({ ok: false, error: "Error al agendar contacto." });
      }
    });

    socket.on("contact:block", async ({ targetUserId }, ack) => {
      try {
        await Contact.findOneAndUpdate(
          {
            owner: socket.user._id,
            target: new mongoose.Types.ObjectId(targetUserId),
          },
          { status: "blocked", since: new Date() },
          { upsert: true, new: true },
        );
        ack?.({ ok: true });
      } catch (err) {
        ack?.({ ok: false, error: "Error al bloquear." });
      }
    });

    socket.on("contact:remove", async ({ targetUserId }, ack) => {
      try {
        await Contact.deleteOne({
          owner: socket.user._id,
          target: new mongoose.Types.ObjectId(targetUserId),
        });
        ack?.({ ok: true });
      } catch (err) {
        ack?.({ ok: false, error: "Error al eliminar contacto." });
      }
    });

    // ── disconnect ────────────────────────────────────────
    socket.on("disconnect", async () => {
      const sockets = onlineUsers.get(userId);
      if (sockets) {
        sockets.delete(socket.id);
        if (sockets.size === 0) {
          onlineUsers.delete(userId);
          await User.findByIdAndUpdate(userId, {
            isOnline: false,
            lastSeenAt: new Date(),
          }).catch(() => {});
          await broadcastPresence(io, socket, "offline");
        }
      }
      console.log(`🔴 [socket] ${username} desconectado`);
    });
  });

  return io;
}

// ═══════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════
async function joinUserRooms(socket) {
  const userId = socket.user.id;
  try {
    const groups = await Group.find({
      "members.user": new mongoose.Types.ObjectId(userId),
      isDeleted: false,
    })
      .select("_id")
      .lean();
    groups.forEach((g) => socket.join(`group:${g._id}`));

    const communities = await Community.find({
      "members.userId": new mongoose.Types.ObjectId(userId),
    })
      .select("_id")
      .lean();
    communities.forEach((c) => socket.join(`community:${c._id}`));
  } catch (err) {
    console.error("[joinUserRooms]", err);
  }
}

async function checkSendPermission(user, roomType, roomId) {
  try {
    if (roomType === "private") {
      const chat = await Chat.findOne({ _id: roomId, participants: user.id })
        .select("participants")
        .lean();
      if (!chat) return { ok: false, error: "Chat no encontrado." };

      const otherId = chat.participants.find(
        (p) => String(p) !== String(user.id),
      );
      if (otherId) {
        const block = await Block.findOne({
          $or: [
            { blocker: user.id, blocked: otherId },
            { blocker: otherId, blocked: user.id },
          ],
        });
        if (block)
          return {
            ok: false,
            error: "No podés enviar mensajes a este usuario.",
          };
      }
      const contactBlock = await Contact.findOne({
        owner: new mongoose.Types.ObjectId(String(roomId)),
        target: user._id,
        status: "blocked",
      });
      if (contactBlock) return { ok: false, error: "Este usuario te bloqueó." };
      return { ok: true };
    }

    if (roomType === "group") {
      const group = await Group.findById(roomId);
      if (!group || group.isDeleted)
        return { ok: false, error: "Grupo no encontrado." };
      if (!group.isMember(user.id))
        return { ok: false, error: "No sos miembro." };
      if (group.isBanned(user.id))
        return { ok: false, error: "Estás baneado." };
      return { ok: true };
    }

    return { ok: false, error: "Tipo de room inválido." };
  } catch {
    return { ok: false, error: "Error de permisos." };
  }
}

async function markChatRead(chatId, readerId) {
  await Chat.updateOne(
    { _id: chatId },
    {
      $set: {
        "messages.$[msg].status": "read",
        "messages.$[msg].readAt": new Date(),
        [`unreadCount.${readerId}`]: 0,
      },
    },
    {
      arrayFilters: [
        {
          "msg.status": { $ne: "read" },
          "msg.sender": { $ne: new mongoose.Types.ObjectId(readerId) },
        },
      ],
    },
  ).catch(() => {});
}

function toggleReaction(reactions, emoji, userId) {
  const existing = reactions.find((r) => r.emoji === emoji);
  if (existing) {
    const idx = existing.userIds.findIndex(
      (id) => String(id) === String(userId),
    );
    if (idx >= 0) existing.userIds.splice(idx, 1);
    else existing.userIds.push(userId);
    if (existing.userIds.length === 0)
      return reactions.filter((r) => r.emoji !== emoji);
  } else {
    reactions.push({ emoji, userIds: [userId] });
  }
  return reactions;
}

function emitToUser(io, onlineUsers, targetUserId, event, data) {
  const sockets = onlineUsers.get(String(targetUserId));
  if (sockets) sockets.forEach((socketId) => io.to(socketId).emit(event, data));
}

async function broadcastPresence(io, socket, status) {
  try {
    const contacts = await Contact.find({
      target: socket.user._id,
      status: "contact",
    })
      .select("owner")
      .lean();
    contacts.forEach((c) => {
      emitToUser(io, onlineUsers, String(c.owner), "user:presence", {
        userId: socket.user.id,
        username: socket.user.username,
        status,
        lastSeenAt: new Date().toISOString(),
      });
    });
  } catch (err) {
    console.error("[broadcastPresence]", err);
  }
}

async function sendSystemMessage(io, roomType, roomId, text) {
  try {
    const msg = await Message.create({
      sender: new mongoose.Types.ObjectId("000000000000000000000000"),
      roomType,
      roomId: new mongoose.Types.ObjectId(roomId),
      text,
      isSystem: true,
    });
    io.to(`${roomType}:${roomId}`).emit("message:new", serializeMessage(msg));
  } catch (err) {
    console.error("[sendSystemMessage]", err);
  }
}

function serializeMessage(msg) {
  const m = msg.toObject ? msg.toObject() : msg;
  return {
    id: String(m._id),
    sender: m.sender,
    roomType: m.roomType,
    roomId: String(m.roomId),
    text: m.deletedForAll ? "" : m.text,
    attachment: m.deletedForAll ? null : (m.attachment ?? null),
    replyTo: m.replyTo ?? null,
    reactions: m.reactions ?? [],
    status: m.status ?? "sent",
    readAt: m.readAt ?? null,
    isSystem: m.isSystem ?? false,
    deleted: m.deletedForAll ?? false,
    createdAt: m.createdAt?.toISOString?.() ?? new Date().toISOString(),
  };
}

function serializeChatMsg(m, roomType, roomId) {
  const sender = m.sender ?? {};
  return {
    id: String(m._id),
    sender: {
      _id: String(sender._id ?? sender),
      username: sender.username ?? "Usuario",
      avatarUrl: sender.avatarUrl ?? null,
      role: sender.role ?? "user",
    },
    roomType,
    roomId: String(roomId),
    text: m.deleted ? "" : (m.text ?? ""),
    attachment: m.attachment ?? null,
    replyTo: m.replyTo ?? null,
    reactions: m.reactions ?? [],
    status: m.status ?? "sent",
    readAt: m.readAt ?? null,
    isSystem: m.isSystem ?? false,
    deleted: m.deleted ?? false,
    createdAt: m.createdAt?.toISOString?.() ?? new Date().toISOString(),
  };
}

module.exports = { initSocket, onlineUsers };
