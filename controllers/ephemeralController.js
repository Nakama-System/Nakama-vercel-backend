// ═══════════════════════════════════════════════════════════
// controllers/ephemeralController.js — Nakama | Chat Temporal
// FIX: imageUrl siempre se devuelve en /view, incluso con oneTimeView
// ═══════════════════════════════════════════════════════════

const mongoose         = require("mongoose");
const EphemeralMessage = require("../models/EphemeralMessage");
const User             = require("../models/User");

// ────────────────────────────────────────────────────────────
// POST /ephemeral
// ────────────────────────────────────────────────────────────
exports.create = async (req, res) => {
  try {
    const senderId = req.user?._id || req.user?.id;
    if (!senderId) return res.status(401).json({ message: "No autenticado." });

    const {
      imageUrl, thumbnailUrl = "", caption = "",
      mimeType = "image/jpeg", size = 0,
      config   = {},
      recipients = [],
      roomType = "private",
      roomId,
    } = req.body;

    if (!imageUrl)             return res.status(400).json({ message: "imageUrl es requerido." });
    if (!recipients.length)    return res.status(400).json({ message: "Necesitás al menos 1 destinatario." });
    if (recipients.length > 5) return res.status(400).json({ message: "Máximo 5 destinatarios." });

    const cleanRecipients = recipients
      .filter((id) => String(id) !== String(senderId))
      .slice(0, 5)
      .map((userId) => ({ userId, viewed: false, viewedAt: null }));

    if (!cleanRecipients.length)
      return res.status(400).json({ message: "Destinatarios inválidos." });

    const duration    = Number(config.duration ?? 10);
    const oneTimeView = config.oneTimeView !== false;

    // expiresAt: 24h de ventana para que el destinatario lo abra
    const expiresAt = duration > 0
      ? new Date(Date.now() + 24 * 60 * 60 * 1000)
      : null;

    const msg = await EphemeralMessage.create({
      senderId:     new mongoose.Types.ObjectId(String(senderId)),
      imageUrl,
      thumbnailUrl,
      caption,
      mimeType,
      size,
      config:     { duration, oneTimeView },
      recipients: cleanRecipients,
      roomType,
      roomId:     roomId ? new mongoose.Types.ObjectId(String(roomId)) : undefined,
      expiresAt,
    });

    // ── Obtener datos del sender para el payload ──────────
    const sender = await User.findById(senderId).select("username avatarUrl").lean();

    const socketPayload = {
      _id:          String(msg._id),
      roomId:       String(roomId || ""),
      roomType:     msg.roomType,
      senderId:     String(senderId),
      senderName:   sender?.username  || req.user?.username  || "Usuario",
      senderAvatar: sender?.avatarUrl || req.user?.avatarUrl || "",
      thumbnailUrl: msg.thumbnailUrl  || msg.imageUrl,
      caption:      msg.caption,
      config:       msg.config,
      createdAt:    msg.createdAt,
    };

    // ── Emitir ephemeral:new a cada destinatario ──────────
    const io = req.app.get("io");
    if (io) {
      cleanRecipients.forEach(({ userId }) => {
        io.to(`user:${String(userId)}`).emit("ephemeral:new", socketPayload);
      });
    } else {
      console.warn("[ephemeral:create] io no disponible en req.app");
    }

    return res.status(201).json({
      _id:        String(msg._id),
      imageUrl:   msg.imageUrl,
      caption:    msg.caption,
      config:     msg.config,
      recipients: cleanRecipients.map((r) => String(r.userId)),
      createdAt:  msg.createdAt,
    });
  } catch (err) {
    console.error("[ephemeral:create]", err);
    return res.status(500).json({ message: "Error al crear mensaje temporal." });
  }
};

// ────────────────────────────────────────────────────────────
// POST /ephemeral/:id/view
// FIX PRINCIPAL: siempre devolver imageUrl antes de destruir.
// checkAndDestroy() se llama DESPUÉS de armar la respuesta,
// y la URL se captura antes de que msg.destroyed cambie.
// ────────────────────────────────────────────────────────────
exports.markViewed = async (req, res) => {
  try {
    const viewerId = String(req.user?._id || req.user?.id);
    if (!viewerId || viewerId === "undefined")
      return res.status(401).json({ message: "No autenticado." });

    const msg = await EphemeralMessage.findById(req.params.id);
    if (!msg)          return res.status(404).json({ message: "Mensaje no encontrado." });
    if (msg.destroyed) return res.status(410).json({ message: "Mensaje ya destruido.", destroyed: true });

    const record = msg.recipients.find((r) => String(r.userId) === viewerId);
    if (!record)
      return res.status(403).json({ message: "No sos destinatario de este mensaje." });

    if (record.viewed && msg.config.oneTimeView)
      return res.status(410).json({ message: "Ya viste este mensaje.", alreadyViewed: true });

    if (!record.viewed) {
      record.viewed   = true;
      record.viewedAt = new Date();

      // Ajustar expiresAt para dar tiempo al usuario de ver la imagen
      // Mínimo 30s extra además de la duración configurada
      if (msg.config.duration > 0) {
        msg.expiresAt = new Date(Date.now() + (msg.config.duration + 30) * 1000);
      } else {
        // oneTimeView sin timer: dar 60s para que el usuario mantenga presionado
        msg.expiresAt = new Date(Date.now() + 60_000);
      }

      await msg.save();
    }

    // ── FIX: capturar imageUrl ANTES de llamar a checkAndDestroy ──
    // checkAndDestroy puede setear msg.destroyed = true y borrar imageUrl
    const safeImageUrl = msg.imageUrl;
    const safeCaption  = msg.caption;

    // Notificar al sender que fue visto (antes de destruir)
    const io = req.app.get("io");
    if (io) {
      io.to(`user:${String(msg.senderId)}`).emit("ephemeral:viewed", {
        messageId: String(msg._id),
        viewedBy:  viewerId,
        viewedAt:  record.viewedAt,
        destroyed: false, // todavía no destruimos
      });
    }

    // ── NO llamar a checkAndDestroy aquí ──
    // La destrucción ocurre cuando el usuario termina de ver:
    // - Si oneTimeView: el cliente llama a POST /ephemeral/:id/destroy al soltar
    // - Si tiene timer: el cliente llama a /destroy cuando el countdown llega a 0
    // Esto garantiza que el usuario SIEMPRE recibe imageUrl antes de que se destruya.

    return res.json({
      ok:        true,
      imageUrl:  safeImageUrl,   // ← siempre la URL real, nunca null
      caption:   safeCaption,
      config:    msg.config,
      duration:  msg.config.duration,
      destroyed: false,          // ← nunca true en /view
      expiresAt: msg.expiresAt,
    });
  } catch (err) {
    console.error("[ephemeral:markViewed]", err);
    return res.status(500).json({ message: "Error al marcar como visto." });
  }
};

// ────────────────────────────────────────────────────────────
// POST /ephemeral/:id/destroy
// Llamado por el cliente cuando el usuario termina de ver
// ────────────────────────────────────────────────────────────
exports.destroy = async (req, res) => {
  try {
    const userId = String(req.user?._id || req.user?.id);
    if (!userId || userId === "undefined")
      return res.status(401).json({ message: "No autenticado." });

    const msg = await EphemeralMessage.findById(req.params.id);
    if (!msg)          return res.status(404).json({ message: "Mensaje no encontrado." });
    if (msg.destroyed) return res.json({ ok: true, destroyed: true });

    const isSender    = String(msg.senderId) === userId;
    const isRecipient = msg.recipients.some((r) => String(r.userId) === userId);
    if (!isSender && !isRecipient)
      return res.status(403).json({ message: "Sin permiso para destruir este mensaje." });

    msg.destroyed   = true;
    msg.destroyedAt = new Date();
    msg.expiresAt   = new Date(Date.now() + 30_000);
    await msg.save();

    const io = req.app.get("io");
    if (io) {
      const targets = [String(msg.senderId), ...msg.recipients.map((r) => String(r.userId))];
      targets.forEach((uid) => {
        io.to(`user:${uid}`).emit("ephemeral:destroyed", { messageId: String(msg._id) });
      });
    }

    return res.json({ ok: true, destroyed: true });
  } catch (err) {
    console.error("[ephemeral:destroy]", err);
    return res.status(500).json({ message: "Error al destruir mensaje." });
  }
};

// ────────────────────────────────────────────────────────────
// GET /ephemeral/received
// ────────────────────────────────────────────────────────────
exports.getReceived = async (req, res) => {
  try {
    const userId = req.user?._id || req.user?.id;
    if (!userId) return res.status(401).json({ message: "No autenticado." });

    const msgs = await EphemeralMessage.find({
      "recipients.userId": userId,
      destroyed: false,
      $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }],
    })
      .populate("senderId", "username avatarUrl")
      .select("-imageUrl")   // imageUrl real solo se entrega en /view
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();

    return res.json(
      msgs.map((m) => ({
        _id:          String(m._id),
        senderId:     String(m.senderId?._id ?? m.senderId),
        senderName:   m.senderId?.username  ?? "Usuario",
        senderAvatar: m.senderId?.avatarUrl ?? "",
        roomId:       String(m.roomId ?? ""),
        roomType:     m.roomType,
        thumbnailUrl: m.thumbnailUrl,
        caption:      m.caption,
        config:       m.config,
        createdAt:    m.createdAt,
        viewed: m.recipients.find((r) => String(r.userId) === String(userId))?.viewed ?? false,
      }))
    );
  } catch (err) {
    console.error("[ephemeral:getReceived]", err);
    return res.status(500).json({ message: "Error al obtener mensajes." });
  }
};