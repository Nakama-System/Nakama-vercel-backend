// ═══════════════════════════════════════════════════════════
// socket/ephemeralSocket.js — Nakama | Socket Chat Temporal
//
// Agregar en socketServer.js dentro de io.on("connection"):
//   require("./ephemeralSocket")(socket, io);
// ═══════════════════════════════════════════════════════════

const EphemeralMessage = require("../models/EphemeralMessage");

module.exports = function registerEphemeralSocket(socket, io) {
  const userId = socket.handshake.auth?.userId || socket.data?.userId;

  // ── El usuario se une a su sala personal para recibir efímeros ──
  // Esto ya debería estar en tu socketServer.js como:
  //   socket.join(`user:${userId}`);
  // Si no está, descomentá la siguiente línea:
  // socket.join(`user:${userId}`);

  // ─────────────────────────────────────────────────────────
  // ephemeral:view — receptor abre el mensaje
  // data: { messageId }
  // ─────────────────────────────────────────────────────────
  socket.on("ephemeral:view", async ({ messageId }, ack) => {
    try {
      const msg = await EphemeralMessage.findById(messageId);
      if (!msg) return ack?.({ ok: false, error: "No encontrado." });
      if (msg.destroyed) return ack?.({ ok: false, destroyed: true, error: "Ya destruido." });

      const record = msg.recipients.find((r) => String(r.userId) === String(userId));
      if (!record) return ack?.({ ok: false, error: "No sos destinatario." });

      // Ya lo vio y es oneTimeView → no mostrar
      if (record.viewed && msg.config.oneTimeView) {
        return ack?.({ ok: false, alreadyViewed: true, error: "Ya viste este mensaje." });
      }

      if (!record.viewed) {
        record.viewed   = true;
        record.viewedAt = new Date();
        if (msg.config.duration > 0) {
          msg.expiresAt = new Date(Date.now() + (msg.config.duration + 5) * 1000);
        }
        await msg.save();
        if (msg.config.oneTimeView) await msg.checkAndDestroy();
      }

      // Notificar al sender
      io.to(`user:${msg.senderId}`).emit("ephemeral:viewed", {
        messageId: String(msg._id),
        viewerId:  String(userId),
        viewedAt:  record.viewedAt,
        destroyed: msg.destroyed,
      });

      return ack?.({
        ok:        true,
        imageUrl:  msg.destroyed ? null : msg.imageUrl,
        caption:   msg.destroyed ? null : msg.caption,
        config:    msg.config,
        expiresAt: msg.expiresAt,
        destroyed: msg.destroyed,
      });
    } catch (err) {
      console.error("[socket ephemeral:view]", err);
      return ack?.({ ok: false, error: "Error del servidor." });
    }
  });

  // ─────────────────────────────────────────────────────────
  // ephemeral:destroy — timer llegó a 0 en el cliente
  // data: { messageId }
  // ─────────────────────────────────────────────────────────
  socket.on("ephemeral:destroy", async ({ messageId }, ack) => {
    try {
      const msg = await EphemeralMessage.findById(messageId);
      if (!msg || msg.destroyed) return ack?.({ ok: true, destroyed: true });

      const isSender    = String(msg.senderId) === String(userId);
      const isRecipient = msg.recipients.some((r) => String(r.userId) === String(userId));
      if (!isSender && !isRecipient) return ack?.({ ok: false, error: "Sin permiso." });

      msg.destroyed   = true;
      msg.destroyedAt = new Date();
      msg.expiresAt   = new Date(Date.now() + 30_000);
      await msg.save();

      // Notificar a todos los involucrados
      const targets = [String(msg.senderId), ...msg.recipients.map((r) => String(r.userId))];
      targets.forEach((uid) => {
        io.to(`user:${uid}`).emit("ephemeral:destroyed", { messageId: String(msg._id) });
      });

      return ack?.({ ok: true, destroyed: true });
    } catch (err) {
      console.error("[socket ephemeral:destroy]", err);
      return ack?.({ ok: false, error: "Error del servidor." });
    }
  });
};