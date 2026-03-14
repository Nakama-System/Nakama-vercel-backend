// ═══════════════════════════════════════════════════════════
// controllers/termsController.js — Nakama
// ═══════════════════════════════════════════════════════════

const TermsVersion = require("../models/TermsVersion");
const User         = require("../models/User");

// ─────────────────────────────────────────────────────────
// GET /terms/active — pública, sin auth
// Devuelve la versión activa de T&C
// ─────────────────────────────────────────────────────────
exports.getActiveTerms = async (req, res) => {
  try {
    const terms = await TermsVersion.getActive();
    if (!terms) {
      return res.status(404).json({ success: false, message: "No hay términos publicados todavía esperemos pronto." });
    }
    return res.json({ success: true, terms });
  } catch (err) {
    console.error("[getActiveTerms]", err);
    return res.status(500).json({ success: false, message: "Error al obtener los términos." });
  }
};

// ─────────────────────────────────────────────────────────
// GET /terms/all — solo superadmin
// Lista todas las versiones (historial)
// ─────────────────────────────────────────────────────────
exports.getAllVersions = async (req, res) => {
  try {
    const versions = await TermsVersion.find()
      .sort({ createdAt: -1 })
      .populate("publishedBy", "username email");
    return res.json({ success: true, versions });
  } catch (err) {
    console.error("[getAllVersions]", err);
    return res.status(500).json({ success: false, message: "Error al obtener historial." });
  }
};

// ─────────────────────────────────────────────────────────
// POST /terms/draft — solo superadmin
// Crea un borrador (no activo todavía)
// Body: { termsVersion, privacyVersion, termsText, privacyText, changesSummary }
// ─────────────────────────────────────────────────────────
exports.createDraft = async (req, res) => {
  try {
    const { termsVersion, privacyVersion, termsText, privacyText, changesSummary = "" } = req.body;

    if (!termsVersion || !privacyVersion || !termsText || !privacyText) {
      return res.status(400).json({ success: false, message: "Completá todos los campos del borrador." });
    }

    // Verificar que no exista esa versión
    const exists = await TermsVersion.findOne({ termsVersion });
    if (exists) {
      return res.status(409).json({ success: false, message: `La versión ${termsVersion} ya existe.` });
    }

    const draft = await TermsVersion.create({
      termsVersion,
      privacyVersion,
      termsText,
      privacyText,
      changesSummary,
      isActive:    false,
      isDraft:     true,
      publishedBy: req.user._id,
    });

    return res.status(201).json({ success: true, message: "Borrador creado.", draft });
  } catch (err) {
    console.error("[createDraft]", err);
    return res.status(500).json({ success: false, message: "Error al crear el borrador." });
  }
};

// ─────────────────────────────────────────────────────────
// PATCH /terms/draft/:id — solo superadmin
// Edita un borrador existente
// ─────────────────────────────────────────────────────────
exports.updateDraft = async (req, res) => {
  try {
    const { id } = req.params;
    const draft = await TermsVersion.findById(id);
    if (!draft) {
      return res.status(404).json({ success: false, message: "Borrador no encontrado." });
    }
    if (!draft.isDraft) {
      return res.status(400).json({ success: false, message: "No podés editar una versión ya publicada." });
    }

    const allowed = ["termsText", "privacyText", "changesSummary", "privacyVersion"];
    for (const field of allowed) {
      if (req.body[field] !== undefined) draft[field] = req.body[field];
    }
    await draft.save();

    return res.json({ success: true, message: "Borrador actualizado.", draft });
  } catch (err) {
    console.error("[updateDraft]", err);
    return res.status(500).json({ success: false, message: "Error al actualizar el borrador." });
  }
};

// ─────────────────────────────────────────────────────────
// POST /terms/publish/:id — SOLO superadmin
// Publica una versión: la activa, desactiva la anterior,
// y marca a TODOS los usuarios con pendingTermsAcceptance
// ─────────────────────────────────────────────────────────
exports.publishTerms = async (req, res) => {
  try {
    const { id } = req.params;
    const draft = await TermsVersion.findById(id);
    if (!draft) {
      return res.status(404).json({ success: false, message: "Versión no encontrada." });
    }
    if (!draft.isDraft) {
      return res.status(400).json({ success: false, message: "Esta versión ya fue publicada." });
    }

    // 1. Desactivar todas las versiones anteriores
    await TermsVersion.updateMany({}, { $set: { isActive: false } });

    // 2. Activar la nueva
    draft.isActive    = true;
    draft.isDraft     = false;
    draft.publishedAt = new Date();
    await draft.save();

    // 3. Marcar a TODOS los usuarios activos como pendientes de aceptar
    const updateResult = await User.updateMany(
      { isActive: true, isBanned: false },
      {
        $set: {
          pendingTermsAcceptance: true,
          pendingTermsVersion:    draft.termsVersion,
        },
      }
    );

    // 4. Notificar via Socket.io a usuarios online
    const io = req.app.get("io");
    if (io) {
      io.emit("terms:update_required", {
        termsVersion:   draft.termsVersion,
        privacyVersion: draft.privacyVersion,
        changesSummary: draft.changesSummary,
        publishedAt:    draft.publishedAt,
        message:        "Se publicaron nuevos Términos y Condiciones. Debés aceptarlos para continuar usando Nakama.",
      });
    }

    return res.json({
      success: true,
      message: `Versión ${draft.termsVersion} publicada. ${updateResult.modifiedCount} usuarios marcados para re-aceptar.`,
      termsVersion: draft.termsVersion,
      usersNotified: updateResult.modifiedCount,
    });
  } catch (err) {
    console.error("[publishTerms]", err);
    return res.status(500).json({ success: false, message: "Error al publicar los términos." });
  }
};

// ─────────────────────────────────────────────────────────
// POST /terms/accept — usuario autenticado
// El usuario acepta la versión actual de T&C
// Body: { termsVersion, privacyVersion }
// ─────────────────────────────────────────────────────────
exports.acceptTerms = async (req, res) => {
  try {
    const { termsVersion, privacyVersion } = req.body;
    if (!termsVersion || !privacyVersion) {
      return res.status(400).json({ success: false, message: "Faltan datos de versión." });
    }

    // Verificar que sea la versión activa real
    const active = await TermsVersion.getActive();
    if (!active) {
      return res.status(404).json({ success: false, message: "No hay términos activos." });
    }
    if (active.termsVersion !== termsVersion) {
      return res.status(400).json({
        success: false,
        message: `Versión incorrecta. Debés aceptar la versión ${active.termsVersion}.`,
      });
    }

    const ip = req.ip || req.headers["x-forwarded-for"] || "unknown";
    const ua = req.headers["user-agent"] || "";

    await User.findByIdAndUpdate(req.user._id, {
      $set: {
        acceptedTermsVersion:   termsVersion,
        acceptedPrivacyVersion: privacyVersion,
        pendingTermsAcceptance: false,
        pendingTermsVersion:    "",
      },
      $push: {
        termsHistory: {
          termsVersion,
          privacyVersion,
          acceptedAt: new Date(),
          acceptedIp: ip,
          acceptedUA: ua,
        },
      },
    });

    // Incrementar contador en TermsVersion
    await TermsVersion.findByIdAndUpdate(active._id, { $inc: { acceptedCount: 1 } });

    return res.json({
      success: true,
      message: "Términos aceptados. ¡Gracias!",
    });
  } catch (err) {
    console.error("[acceptTerms]", err);
    return res.status(500).json({ success: false, message: "Error al registrar la aceptación." });
  }
};