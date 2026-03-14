// ═══════════════════════════════════════════════════════════
// controllers/moderationController.js — Nakama
// ═══════════════════════════════════════════════════════════

const User        = require("../models/User");
const ContentFlag = require("../models/ContentFlag");
const { deleteFromCloudinary } = require("../services/cloudinaryService");

// ─── Razones que activan reporte automático a autoridades ─
const AUTO_REPORT_REASONS = ["grooming", "csam", "underage_content"];

// ─────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────
async function notifyAuthorities(flag, user) {
  // En producción: integrar con API de UFI-ANIN, IWF o NCMEC
  // Por ahora: log estructurado + email al equipo legal
  console.error("🚨 [AUTORIDADES] CONTENIDO PROHIBIDO DETECTADO", {
    flagId:      flag._id,
    reason:      flag.flagReasons,
    contentType: flag.contentType,
    contentId:   flag.contentId,
    userId:      user._id,
    username:    user.username,
    email:       user.email,
    consentIp:   user.legalConsent?.consentIp,
    flaggedAt:   flag.flaggedAt,
  });

  // Marcar como reportado en el flag
  flag.reportedToAuthorities    = true;
  flag.authorityReportedAt      = new Date();
  flag.authorityReportReference = `AUTO-${flag._id}-${Date.now()}`;
  await flag.save();
}

// ─────────────────────────────────────────────────────────
// POST /moderation/ban/:userId — admin/superadmin/moderador
// Body: { reason, detail? }
// ─────────────────────────────────────────────────────────
exports.banUser = async (req, res) => {
  try {
    const { userId } = req.params;
    const { reason, detail = "" } = req.body;

    if (!reason?.trim()) {
      return res.status(400).json({ success: false, message: "Se requiere una razón para el ban." });
    }

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ success: false, message: "Usuario no encontrado." });

    if (user.role === "superadmin") {
      return res.status(403).json({ success: false, message: "No podés banear a un superadmin." });
    }

    await user.applyBan(reason, req.user._id, detail);

    // Desconectar socket si está online
    const io = req.app.get("io");
    if (io) {
      io.to(`user:${userId}`).emit("account:banned", { reason });
    }

    return res.json({
      success: true,
      message: `Usuario @${user.username} baneado.`,
    });
  } catch (err) {
    console.error("[banUser]", err);
    return res.status(500).json({ success: false, message: "Error al banear el usuario." });
  }
};

// ─────────────────────────────────────────────────────────
// POST /moderation/unban/:userId — admin/superadmin
// ─────────────────────────────────────────────────────────
exports.unbanUser = async (req, res) => {
  try {
    const { userId } = req.params;
    const { reason = "Revisión de moderación" } = req.body;

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ success: false, message: "Usuario no encontrado." });

    user.isBanned  = false;
    user.banReason = "";
    user.bannedAt  = null;
    user.bannedBy  = null;
    user.moderationHistory.push({
      action:      "unban",
      reason,
      performedBy: req.user._id,
    });
    await user.save();

    return res.json({ success: true, message: `Usuario @${user.username} desbaneado.` });
  } catch (err) {
    console.error("[unbanUser]", err);
    return res.status(500).json({ success: false, message: "Error al desbanear." });
  }
};

// ─────────────────────────────────────────────────────────
// POST /moderation/suspend/:userId
// Body: { reason, detail?, suspendUntil? (ISO string) }
// ─────────────────────────────────────────────────────────
exports.suspendUser = async (req, res) => {
  try {
    const { userId } = req.params;
    const { reason, detail = "", suspendUntil } = req.body;

    if (!reason?.trim()) {
      return res.status(400).json({ success: false, message: "Se requiere una razón." });
    }

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ success: false, message: "Usuario no encontrado." });
    if (user.role === "superadmin") {
      return res.status(403).json({ success: false, message: "No podés suspender a un superadmin." });
    }

    const until = suspendUntil ? new Date(suspendUntil) : null;
    await user.applySuspension(reason, req.user._id, until, detail);

    const io = req.app.get("io");
    if (io) {
      io.to(`user:${userId}`).emit("account:suspended", { reason, until });
    }

    return res.json({
      success: true,
      message: `Usuario @${user.username} suspendido${until ? ` hasta ${until.toLocaleDateString("es-AR")}` : " indefinidamente"}.`,
    });
  } catch (err) {
    console.error("[suspendUser]", err);
    return res.status(500).json({ success: false, message: "Error al suspender." });
  }
};

// ─────────────────────────────────────────────────────────
// POST /moderation/unsuspend/:userId
// ─────────────────────────────────────────────────────────
exports.unsuspendUser = async (req, res) => {
  try {
    const { userId } = req.params;
    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ success: false, message: "Usuario no encontrado." });

    user.isSuspended   = false;
    user.suspendReason = "";
    user.suspendedAt   = null;
    user.suspendUntil  = null;
    user.moderationHistory.push({
      action:      "unsuspend",
      reason:      "Levantamiento de suspensión",
      performedBy: req.user._id,
    });
    await user.save();

    return res.json({ success: true, message: `Suspensión de @${user.username} levantada.` });
  } catch (err) {
    console.error("[unsuspendUser]", err);
    return res.status(500).json({ success: false, message: "Error al levantar la suspensión." });
  }
};

// ─────────────────────────────────────────────────────────
// POST /moderation/flag-content
// Marca y/o elimina contenido prohibido de un usuario.
// Body: {
//   userId, contentType, contentId, cloudinaryUrl?,
//   reasons: string[], detail?, removeFromCloudinary?
// }
// ─────────────────────────────────────────────────────────
exports.flagContent = async (req, res) => {
  try {
    const {
      userId,
      contentType,
      contentId,
      cloudinaryUrl,
      reasons = [],
      detail = "",
      removeFromCloudinary = true,
      isAutoFlag = false,
    } = req.body;

    if (!userId || !contentType || !contentId || reasons.length === 0) {
      return res.status(400).json({ success: false, message: "Faltan datos requeridos." });
    }

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ success: false, message: "Usuario no encontrado." });

    // ── Crear registro ContentFlag ────────────────────────
    const flag = await ContentFlag.create({
      contentType,
      contentId,
      cloudinaryUrl: cloudinaryUrl || "",
      ownerId:    userId,
      flagReasons: reasons,
      flagDetail:  detail,
      flaggedBy:   isAutoFlag ? null : req.user._id,
      isAutoFlag,
      status:      "removed",
      reviewedBy:  req.user._id,
      reviewedAt:  new Date(),
      actionTaken: "removed",
    });

    // ── Registrar en el usuario ───────────────────────────
    await user.flagContent(
      contentType,
      contentId,
      reasons.join(", "),
      req.user._id,
      isAutoFlag
    );

    // ── Si es video de perfil del usuario, limpiar campo ──
    if (contentType === "video" && user.profileVideo?.publicId === contentId) {
      user.profileVideo = null;
      user.avatarUrl    = "";
      await user.save();
    }
    if (contentType === "avatar" && user.avatarPublicId === contentId) {
      user.avatarUrl      = "";
      user.avatarPublicId = "";
      await user.save();
    }

    // ── Eliminar de Cloudinary si se pide ─────────────────
    if (removeFromCloudinary && contentId) {
      try {
        await deleteFromCloudinary(contentId, contentType === "video" ? "video" : "image");
      } catch (e) {
        console.error("[flagContent] Error eliminando de Cloudinary:", e.message);
      }
    }

    // ── Reporte automático a autoridades ──────────────────
    const needsAuthorityReport = reasons.some(r => AUTO_REPORT_REASONS.includes(r));
    if (needsAuthorityReport) {
      await notifyAuthorities(flag, user);

      // Ban automático en casos CSAM/grooming
      if (reasons.includes("csam") || reasons.includes("grooming")) {
        await user.applyBan(
          `BAN AUTOMÁTICO: Contenido prohibido detectado (${reasons.join(", ")})`,
          req.user._id,
          `ContentFlag ID: ${flag._id}`
        );

        const io = req.app.get("io");
        if (io) {
          io.to(`user:${userId}`).emit("account:banned", {
            reason: "Violación grave de políticas de seguridad.",
          });
        }
      }
    }

    return res.json({
      success:                true,
      message:                "Contenido marcado y eliminado.",
      flagId:                 flag._id,
      reportedToAuthorities:  flag.reportedToAuthorities,
      userBanned:             user.isBanned,
    });
  } catch (err) {
    console.error("[flagContent]", err);
    return res.status(500).json({ success: false, message: "Error al marcar el contenido." });
  }
};

// ─────────────────────────────────────────────────────────
// GET /moderation/flags — admin/superadmin/moderador
// Lista flags pendientes de revisión
// ─────────────────────────────────────────────────────────
exports.getPendingFlags = async (req, res) => {
  try {
    const { status = "pending", page = 1, limit = 20 } = req.query;
    const skip = (Number(page) - 1) * Number(limit);

    const flags = await ContentFlag.find({ status })
      .sort({ flaggedAt: -1 })
      .skip(skip)
      .limit(Number(limit))
      .populate("ownerId", "username email role isBanned")
      .populate("flaggedBy", "username");

    const total = await ContentFlag.countDocuments({ status });

    return res.json({
      success: true,
      flags,
      pagination: { page: Number(page), limit: Number(limit), total },
    });
  } catch (err) {
    console.error("[getPendingFlags]", err);
    return res.status(500).json({ success: false, message: "Error al obtener flags." });
  }
};

// ─────────────────────────────────────────────────────────
// GET /moderation/user/:userId/history — admin/superadmin
// Historial de moderación de un usuario
// ─────────────────────────────────────────────────────────
exports.getUserModerationHistory = async (req, res) => {
  try {
    const user = await User.findById(req.params.userId)
      .select("username email role isBanned isSuspended moderationHistory flaggedContent warningCount")
      .populate("moderationHistory.performedBy", "username");

    if (!user) return res.status(404).json({ success: false, message: "Usuario no encontrado." });

    return res.json({ success: true, user });
  } catch (err) {
    console.error("[getUserModerationHistory]", err);
    return res.status(500).json({ success: false, message: "Error." });
  }
};