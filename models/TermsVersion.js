// ═══════════════════════════════════════════════════════════
// models/TermsVersion.js — Nakama
// ═══════════════════════════════════════════════════════════

const mongoose = require("mongoose");

const termsVersionSchema = new mongoose.Schema({
  // Identificadores de versión semántica: "1.0", "1.1", "2.0"
  termsVersion:   { type: String, required: true, unique: true },
  privacyVersion: { type: String, required: true },

  // Contenido completo en texto plano y/o HTML sanitizado
  termsText:      { type: String, required: true },
  privacyText:    { type: String, required: true },

  // Resumen de qué cambió (mostrado al usuario en el modal)
  changesSummary: { type: String, default: "" },

  // ¿Está activa (la que deben aceptar usuarios nuevos y existentes)?
  isActive:       { type: Boolean, default: false, index: true },

  // Quién la publicó y cuándo
  publishedBy:    { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  publishedAt:    { type: Date },

  // Si está en borrador (no publicada todavía)
  isDraft:        { type: Boolean, default: true },

  // Cuántos usuarios la han aceptado (cache, se incrementa con $inc)
  acceptedCount:  { type: Number, default: 0 },

}, { timestamps: true });

// ─── Método estático: obtener la versión activa ───────────
termsVersionSchema.statics.getActive = function () {
  return this.findOne({ isActive: true, isDraft: false }).sort({ publishedAt: -1 });
};

const TermsVersion = mongoose.model("TermsVersion", termsVersionSchema);
module.exports = TermsVersion;