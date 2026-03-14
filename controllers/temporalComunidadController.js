// ═══════════════════════════════════════════════════════════
// controllers/temporalComunidadController.js — Nakama [ARREGLADO]
// ✅ INCLUYE AL SENDER EN RECIPIENTS (CRITICAL FIX)
// ═══════════════════════════════════════════════════════════

const mongoose                 = require("mongoose");
const EphemeralMessageCommunity = require("../models/EphemeralmessageComunnity");
const User                     = require("../models/User");

// ── Helper: verificar si el usuario es owner/admin de la comunidad ──
async function isCommunityAdmin(userId, communityId) {
  try {
    const Community = require("../models/Community");
    const community = await Community.findById(communityId).lean();
    if (!community) return false;
    const uid = String(userId);
    if (String(community.owner) === uid) return true;
    if (Array.isArray(community.admins) && community.admins.some((a) => String(a) === uid)) return true;
    return false;
  } catch {
    return false;
  }
}

// ─────────────────────────────────────────────────────────────
// POST /comunidadtemporal [ARREGLADO]
// Crea un mensaje temporal en una comunidad
// ✅ Ahora INCLUYE al sender en recipients
// ─────────────────────────────────────────────────────────────
exports.create = async (req, res) => {
  try {
    // ✅ MEJORADO: obtener senderId de múltiples fuentes
    const senderId = req.user?._id || req.user?.id;

    if (!senderId) {
      console.error("[ephemeral:create] No senderId found in req.user:", req.user);
      return res.status(401).json({ 
        message: "No estás autenticado. Por favor, loguéate de nuevo.",
        debug: process.env.NODE_ENV === "development" ? { user: req.user } : undefined,
      });
    }

    const {
      imageUrl,
      thumbnailUrl,
      caption,
      mimeType,
      size,
      config,
      roomId,
      roomType = "community",
    } = req.body;

    // ✅ Validar roomId
    if (!roomId) {
      return res.status(400).json({ message: "roomId es requerido" });
    }

    let validRoomId;
    try {
      validRoomId = new mongoose.Types.ObjectId(String(roomId).trim());
    } catch (err) {
      return res.status(400).json({ 
        message: "roomId inválido",
        received: String(roomId),
      });
    }

    // ✅ MEJORADO: validar senderId con mejor error
    let validSenderId;
    try {
      validSenderId = new mongoose.Types.ObjectId(String(senderId).trim());
    } catch (err) {
      console.error("[ephemeral:create] senderId inválido:", {
        received: String(senderId),
        type: typeof senderId,
        error: err.message,
        user: req.user,
      });
      return res.status(401).json({ 
        message: "El ID de usuario no es válido. Por favor, loguéate de nuevo.",
        debug: process.env.NODE_ENV === "development" ? {
          received: String(senderId),
          type: typeof senderId,
          error: err.message,
        } : undefined,
      });
    }

    // ✅ CRITICAL FIX: Obtener miembros de la comunidad INCLUYENDO AL SENDER
    let recipients = [];
    try {
      const Community = require("../models/Community");
      const community = await Community.findById(validRoomId).lean();
      
      if (community && Array.isArray(community.members)) {
        recipients = community.members
          .map((m) => {
            let memberId;
            if (typeof m === "string") {
              memberId = m;
            } else if (m && typeof m === "object") {
              memberId = m._id || m.userId || m.id;
            }

            if (!memberId) return null;

            try {
              return {
                userId: new mongoose.Types.ObjectId(String(memberId)),
                viewed: false,
                viewedAt: null,
              };
            } catch (e) {
              console.warn("[ephemeral] Invalid member ID:", memberId);
              return null;
            }
          })
          .filter((r) => r !== null);
        // ✅ NO EXCLUIR AL SENDER - ahora está incluido
      }
    } catch (err) {
      console.warn("[ephemeral:create] Warning extrayendo miembros:", err.message);
      recipients = [];
    }

    console.log("[ephemeral:create] Recipients:", {
      count: recipients.length,
      senderId: String(validSenderId),
      senderIncluded: recipients.some((r) => String(r.userId) === String(validSenderId)),
    });

    // ✅ Calcular expiración
    const expiresAt =
      config?.duration > 0
        ? new Date(Date.now() + config.duration * 1000)
        : null;

    // ✅ Crear el mensaje temporal
    const msg = await EphemeralMessageCommunity.create({
      senderId: validSenderId,
      imageUrl: imageUrl || null,
      thumbnailUrl: thumbnailUrl || null,
      caption: caption || "",
      mimeType: mimeType || "text/plain",
      size: size || 0,
      config: {
        duration: config?.duration ?? 0,
        oneTimeView: config?.oneTimeView ?? true,
      },
      recipients,
      roomType,
      roomId: validRoomId,
      expiresAt,
    });

    console.log("[ephemeral:create] ✅ Mensaje creado:", msg._id);

    // ✅ Emitir por socket a la comunidad
    try {
      const io = req.app.get("io");
      if (io) {
        const sender = await User.findById(validSenderId)
          .select("username avatarUrl profileVideo")
          .lean();
        
        const payload = {
          _id: String(msg._id),
          roomId: String(validRoomId),
          roomType,
          senderId: String(validSenderId),
          senderName: sender?.username || "Anón",
          senderAvatar: sender?.avatarUrl || null,
          senderVideo: sender?.profileVideo?.url || null,
          thumbnailUrl: msg.thumbnailUrl,
          caption: msg.caption,
          imageUrl: msg.imageUrl,
          config: msg.config,
          createdAt: msg.createdAt,
        };
        io.to(`community:${String(validRoomId)}`).emit("community:ephemeral_new", payload);
      }
    } catch (err) {
      console.warn("[ephemeral:create] Warning emitiendo socket:", err.message);
    }

    return res.status(201).json({ 
      _id: String(msg._id),
      roomId: String(validRoomId),
      createdAt: msg.createdAt,
    });
  } catch (err) {
    console.error("[temporalComunidad:create] Error:", err);
    return res.status(500).json({ 
      message: "Error al crear mensaje temporal",
      error: process.env.NODE_ENV === "development" ? err.message : undefined,
    });
  }
};

// ─────────────────────────────────────────────────────────────
// POST /comunidadtemporal/:id/view
// Registra que el usuario actual vio el mensaje
// ─────────────────────────────────────────────────────────────
exports.markViewed = async (req, res) => {
  try {
    const userId = req.user?._id || req.user?.id;
    if (!userId) return res.status(401).json({ message: "No autenticado" });

    const msg = await EphemeralMessageCommunity.findById(req.params.id);
    if (!msg) return res.status(404).json({ message: "No encontrado" });
    if (msg.destroyed) {
      // Igual devolver ok:true con los datos para que el modal abra
      return res.status(200).json({
        ok: true,
        imageUrl: msg.imageUrl,
        caption: msg.caption,
        destroyed: true,
      });
    }

    const recipient = msg.recipients.find(
      (r) => String(r.userId) === String(userId)
    );
    
    // ✅ Si no está en recipients, verificar que sea miembro de la comunidad
    if (!recipient) {
      const isSender = String(msg.senderId) === String(userId);
      const adminOk  = await isCommunityAdmin(userId, msg.roomId);
      if (!isSender && !adminOk) {
        // Último recurso: buscar en Community directamente
        try {
          const Community = require("../models/Community");
          const community = await Community.findById(msg.roomId).lean();
          const isMember  = community?.members?.some((m) => {
            const mid = m._id || m.userId || m;
            return String(mid) === String(userId);
          });
          if (!isMember) {
            return res.status(403).json({ message: "No sos miembro de esta comunidad" });
          }
        } catch {
          return res.status(403).json({ message: "No se pudo verificar membresía" });
        }
      }
      // Agregar como recipient al vuelo
      msg.recipients.push({ userId, viewed: true, viewedAt: new Date() });
    } else {
      if (!recipient.viewed) {
        recipient.viewed   = true;
        recipient.viewedAt = new Date();
      }
    }

    const allViewed = msg.recipients.every((r) => r.viewed);
    if (msg.config?.oneTimeView || allViewed) {
      msg.destroyed   = true;
      msg.destroyedAt = new Date();
    }

    await msg.save();

    try {
      const io = req.app.get("io");
      if (io) {
        io.to(`user:${String(msg.senderId)}`).emit("community:ephemeral_viewed", {
          messageId: String(msg._id),
          viewedBy: String(userId),
        });
        if (msg.destroyed) {
          io.to(`community:${String(msg.roomId)}`).emit("community:ephemeral_destroyed", {
            messageId: String(msg._id),
          });
        }
      }
    } catch (err) {
      console.warn("[ephemeral:markViewed] Warning socket:", err.message);
    }

    return res.status(200).json({
      ok: true,
      imageUrl: msg.imageUrl,
      caption: msg.caption,
      destroyed: msg.destroyed,
    });
  } catch (err) {
    console.error("[temporalComunidad:markViewed] Error:", err);
    return res.status(500).json({ message: "Error al registrar vista" });
  }
};
// ─────────────────────────────────────────────────────────────
// POST /comunidadtemporal/:id/destroy
// Destruye el mensaje (sender, owner o admin de la comunidad)
// ─────────────────────────────────────────────────────────────
exports.destroy = async (req, res) => {
  try {
    const userId = req.user?._id || req.user?.id;
    if (!userId) {
      return res.status(401).json({ message: "No autenticado" });
    }

    const msg = await EphemeralMessageCommunity.findById(req.params.id);

    if (!msg)          return res.status(404).json({ message: "No encontrado" });
    if (msg.destroyed) return res.status(410).json({ message: "Ya destruido" });

    const isSender = String(msg.senderId) === String(userId);
    const isAdmin  = await isCommunityAdmin(userId, msg.roomId);

    if (!isSender && !isAdmin)
      return res.status(403).json({ message: "Sin permisos" });

    msg.destroyed   = true;
    msg.destroyedAt = new Date();
    await msg.save();

    try {
      const io = req.app.get("io");
      if (io) {
        io.to(`community:${String(msg.roomId)}`).emit("community:ephemeral_destroyed", {
          messageId: String(msg._id),
        });
      }
    } catch (err) {
      console.warn("[ephemeral:destroy] Warning emitiendo socket:", err.message);
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("[temporalComunidad:destroy] Error:", err);
    return res.status(500).json({ message: "Error al destruir" });
  }
};

// ─────────────────────────────────────────────────────────────
// GET /comunidadtemporal/received?roomId=xxx
// Devuelve mensajes temporales pendientes de ver en una comunidad
// ─────────────────────────────────────────────────────────────
exports.getReceived = async (req, res) => {
  try {
    const userId = req.user?._id || req.user?.id;
    if (!userId) {
      return res.status(401).json({ message: "No autenticado" });
    }

    const { roomId } = req.query;
    
    if (!roomId) return res.status(400).json({ message: "roomId requerido" });

    // ✅ Validar roomId
    let validRoomId;
    try {
      validRoomId = new mongoose.Types.ObjectId(String(roomId).trim());
    } catch (err) {
      return res.status(400).json({ message: "roomId inválido" });
    }

    const pending = await EphemeralMessageCommunity.find({
      roomId: validRoomId,
      roomType: "community",
      destroyed: false,
      recipients: {
        $elemMatch: { userId: new mongoose.Types.ObjectId(String(userId)), viewed: false },
      },
      $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }],
    })
      .populate("senderId", "username avatarUrl profileVideo")
      .lean();

    const result = pending.map((m) => ({
      _id: String(m._id),
      roomId: String(m.roomId),
      roomType: m.roomType,
      senderId: String(m.senderId?._id ?? m.senderId),
      senderName: m.senderId?.username || "Anón",
      senderAvatar: m.senderId?.avatarUrl || null,
      senderVideo: m.senderId?.profileVideo?.url || null,
      thumbnailUrl: m.thumbnailUrl,
      caption: m.caption,
      imageUrl: m.imageUrl,
      config: m.config,
      createdAt: m.createdAt,
    }));

    return res.status(200).json(result);
  } catch (err) {
    console.error("[temporalComunidad:getReceived] Error:", err);
    return res.status(500).json({ message: "Error al obtener mensajes" });
  }
};

// ─────────────────────────────────────────────────────────────
// DELETE /comunidadtemporal/:id
// Elimina un mensaje temporal (solo owner/admin o sender)
// ─────────────────────────────────────────────────────────────
exports.deleteForMember = async (req, res) => {
  try {
    const userId = req.user?._id || req.user?.id;
    if (!userId) {
      return res.status(401).json({ message: "No autenticado" });
    }

    const msg = await EphemeralMessageCommunity.findById(req.params.id);

    if (!msg) return res.status(404).json({ message: "No encontrado" });

    const isSender = String(msg.senderId) === String(userId);
    const isAdmin  = await isCommunityAdmin(userId, msg.roomId);

    if (!isSender && !isAdmin)
      return res.status(403).json({ message: "Sin permisos" });

    await EphemeralMessageCommunity.deleteOne({ _id: msg._id });

    try {
      const io = req.app.get("io");
      if (io) {
        io.to(`community:${String(msg.roomId)}`).emit("community:ephemeral_deleted", {
          messageId: String(msg._id),
        });
      }
    } catch (err) {
      console.warn("[ephemeral:deleteForMember] Warning emitiendo socket:", err.message);
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("[temporalComunidad:deleteForMember] Error:", err);
    return res.status(500).json({ message: "Error al eliminar" });
  }
};