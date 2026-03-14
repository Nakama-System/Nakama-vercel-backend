// ═══════════════════════════════════════════════════════════
// routes/contactRoutes.js — Nakama
// CRUD completo de agenda / contactos
// ═══════════════════════════════════════════════════════════

const express     = require("express");
const router      = express.Router();
const { protect } = require("../middlewares/authMiddleware");
const User        = require("../models/User");
const Contact     = require("../models/Contact");

// Aplicar protect a todas las rutas (igual que chatRoutes.js)
router.use(protect);

// ─────────────────────────────────────────────────────────
// GET /contacts
// Lista todos los contactos de la agenda del usuario
// ─────────────────────────────────────────────────────────
router.get("/", async (req, res) => {
  try {
    const contacts = await Contact.find({ owner: req.user.id, blocked: false })
      .populate("contact", "username avatarUrl profileVideo role")
      .sort({ createdAt: -1 })
      .lean();

    const result = contacts.map(c => ({
      _id:          String(c.contact._id),
      username:     c.contact.username,
      avatarUrl:    c.contact.avatarUrl    || null,
      profileVideo: c.contact.profileVideo || null,
      role:         c.contact.role,
      source:       c.source  || "nakama",
      alias:        c.alias   || "",
      notes:        c.notes   || "",
      blocked:      c.blocked,
      contactDocId: String(c._id),
      createdAt:    c.createdAt,
    }));

    res.json(result);
  } catch (err) {
    console.error("[GET /contacts]", err);
    res.status(500).json({ message: "Error al obtener contactos." });
  }
});

// ─────────────────────────────────────────────────────────
// GET /contacts/check/:targetUserId
// Verifica si un usuario ya está en la agenda
// IMPORTANTE: rutas fijas SIEMPRE antes de /:param
// ─────────────────────────────────────────────────────────
router.get("/check/:targetUserId", async (req, res) => {
  try {
    const doc = await Contact.findOne({
      owner:   req.user.id,
      contact: req.params.targetUserId,
    }).lean();

    res.json({
      inAgenda: !!doc,
      blocked:  doc?.blocked ?? false,
      alias:    doc?.alias   ?? "",
      source:   doc?.source  ?? null,
    });
  } catch (err) {
    console.error("[GET /contacts/check]", err);
    res.status(500).json({ message: "Error al verificar contacto." });
  }
});

// ─────────────────────────────────────────────────────────
// GET /contacts/blocked
// Lista los contactos bloqueados del usuario
// ─────────────────────────────────────────────────────────
router.get("/blocked", async (req, res) => {
  try {
    const docs = await Contact.find({ owner: req.user.id, blocked: true })
      .populate("contact", "username avatarUrl role")
      .sort({ updatedAt: -1 })
      .lean();

    res.json(docs.map(d => ({
      _id:          String(d.contact._id),
      username:     d.contact.username,
      avatarUrl:    d.contact.avatarUrl || null,
      role:         d.contact.role,
      contactDocId: String(d._id),
      blockedAt:    d.updatedAt,
    })));
  } catch (err) {
    console.error("[GET /contacts/blocked]", err);
    res.status(500).json({ message: "Error al obtener bloqueados." });
  }
});

// ─────────────────────────────────────────────────────────
// POST /contacts
// Agrega un usuario a la agenda (upsert — no duplica)
// Body: { targetUserId, source?, alias?, notes? }
// ─────────────────────────────────────────────────────────
router.post("/", async (req, res) => {
  try {
    const { targetUserId, source = "nakama", alias = "", notes = "" } = req.body;

    if (!targetUserId) {
      return res.status(400).json({ message: "targetUserId es requerido." });
    }
    if (String(targetUserId) === String(req.user.id)) {
      return res.status(400).json({ message: "No podés agregarte a vos mismo." });
    }

    const target = await User
      .findById(targetUserId)
      .select("username avatarUrl profileVideo role")
      .lean();

    if (!target) {
      return res.status(404).json({ message: "Usuario no encontrado." });
    }

    const doc = await Contact.findOneAndUpdate(
      { owner: req.user.id, contact: targetUserId },
      {
        $set: {
          source:  source,
          alias:   alias.slice(0, 50),
          notes:   notes.slice(0, 500),
          blocked: false,
        },
        $setOnInsert: {
          owner:   req.user.id,
          contact: targetUserId,
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    res.status(201).json({
      _id:          String(target._id),
      username:     target.username,
      avatarUrl:    target.avatarUrl    || null,
      profileVideo: target.profileVideo || null,
      role:         target.role,
      source:       doc.source,
      alias:        doc.alias,
      notes:        doc.notes,
      blocked:      doc.blocked,
      contactDocId: String(doc._id),
      createdAt:    doc.createdAt,
    });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(200).json({ message: "Ya está en tu agenda." });
    }
    console.error("[POST /contacts]", err);
    res.status(500).json({ message: "Error al agregar contacto." });
  }
});

// ─────────────────────────────────────────────────────────
// POST /contacts/:targetUserId/block
// Bloquea un contacto (upsert — crea el doc si no existe)
// ─────────────────────────────────────────────────────────
router.post("/:targetUserId/block", async (req, res) => {
  try {
    const doc = await Contact.findOneAndUpdate(
      { owner: req.user.id, contact: req.params.targetUserId },
      {
        $set: { blocked: true },
        $setOnInsert: {
          owner:   req.user.id,
          contact: req.params.targetUserId,
          source:  "manual",
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    res.json({ message: "Usuario bloqueado.", contactDocId: String(doc._id) });
  } catch (err) {
    console.error("[POST /contacts/block]", err);
    res.status(500).json({ message: "Error al bloquear usuario." });
  }
});

// ─────────────────────────────────────────────────────────
// POST /contacts/:targetUserId/unblock
// Desbloquea un contacto
// ─────────────────────────────────────────────────────────
router.post("/:targetUserId/unblock", async (req, res) => {
  try {
    const doc = await Contact.findOneAndUpdate(
      { owner: req.user.id, contact: req.params.targetUserId },
      { $set: { blocked: false } },
      { new: true }
    );

    if (!doc) {
      return res.status(404).json({ message: "Contacto no encontrado." });
    }

    res.json({ message: "Usuario desbloqueado.", contactDocId: String(doc._id) });
  } catch (err) {
    console.error("[POST /contacts/unblock]", err);
    res.status(500).json({ message: "Error al desbloquear usuario." });
  }
});

// ─────────────────────────────────────────────────────────
// PATCH /contacts/:targetUserId
// Edita alias, notes o source de un contacto existente
// Body: { alias?, notes?, source? }
// ─────────────────────────────────────────────────────────
router.patch("/:targetUserId", async (req, res) => {
  try {
    const { alias, notes, source } = req.body;
    const update = {};

    if (alias  !== undefined) update.alias  = alias.slice(0, 50);
    if (notes  !== undefined) update.notes  = notes.slice(0, 500);
    if (source !== undefined) update.source = source;

    if (Object.keys(update).length === 0) {
      return res.status(400).json({ message: "No hay campos para actualizar." });
    }

    const doc = await Contact
      .findOneAndUpdate(
        { owner: req.user.id, contact: req.params.targetUserId },
        { $set: update },
        { new: true }
      )
      .populate("contact", "username avatarUrl role");

    if (!doc) {
      return res.status(404).json({ message: "Contacto no encontrado en tu agenda." });
    }

    res.json({
      message:      "Contacto actualizado.",
      _id:          String(doc.contact._id),
      username:     doc.contact.username,
      avatarUrl:    doc.contact.avatarUrl || null,
      alias:        doc.alias,
      notes:        doc.notes,
      source:       doc.source,
      contactDocId: String(doc._id),
    });
  } catch (err) {
    console.error("[PATCH /contacts]", err);
    res.status(500).json({ message: "Error al actualizar contacto." });
  }
});

// ─────────────────────────────────────────────────────────
// DELETE /contacts/:targetUserId
// Elimina un contacto de la agenda
// ─────────────────────────────────────────────────────────
router.delete("/:targetUserId", async (req, res) => {
  try {
    const doc = await Contact.findOneAndDelete({
      owner:   req.user.id,
      contact: req.params.targetUserId,
    });

    if (!doc) {
      return res.status(404).json({ message: "Contacto no encontrado en tu agenda." });
    }

    res.json({ message: "Contacto eliminado de tu agenda.", contactDocId: String(doc._id) });
  } catch (err) {
    console.error("[DELETE /contacts]", err);
    res.status(500).json({ message: "Error al eliminar contacto." });
  }
});

module.exports = router;