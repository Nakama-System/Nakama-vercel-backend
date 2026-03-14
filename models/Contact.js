// ═══════════════════════════════════════════════════════════
// models/Contact.js — Nakama
// Agenda de contactos del usuario
// ═══════════════════════════════════════════════════════════

const mongoose = require("mongoose");

const contactSchema = new mongoose.Schema(
  {
    // Dueño de la agenda
    owner: {
      type:     mongoose.Schema.Types.ObjectId,
      ref:      "User",
      required: true,
      index:    true,
    },

    // Usuario guardado
    contact: {
      type:     mongoose.Schema.Types.ObjectId,
      ref:      "User",
      required: true,
    },

    // Apodo personalizado (opcional)
    alias: {
      type:    String,
      default: "",
      maxlength: 50,
    },

    // Nota privada sobre el contacto
    notes: {
      type:    String,
      default: "",
      maxlength: 500,
    },

    // De dónde vino el contacto
    source: {
      type:    String,
      enum:    ["nakama", "instagram", "tiktok", "facebook", "contacto", "manual"],
      default: "nakama",
    },

    // Si está bloqueado
    blocked: {
      type:    Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  }
);

// Índice único: un usuario no puede tener el mismo contacto dos veces
contactSchema.index({ owner: 1, contact: 1 }, { unique: true });

module.exports = mongoose.model("Contact", contactSchema);