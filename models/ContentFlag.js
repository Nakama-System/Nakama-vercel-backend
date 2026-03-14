// ═══════════════════════════════════════════════════════════
// models/ContentFlag.js — Nakama
// ═══════════════════════════════════════════════════════════

const mongoose = require("mongoose");

const contentFlagSchema = new mongoose.Schema({
  // ── Qué contenido ──────────────────────────────────────
  contentType: {
    type: String,
    enum: ["video", "image", "gif", "avatar", "post", "comment"],
    required: true,
    index: true,
  },
  contentId:    { type: String, required: true, index: true }, // Cloudinary public_id o MongoDB _id
  cloudinaryUrl:{ type: String },
  ownerId:      { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },

  // ── Por qué fue marcado ────────────────────────────────
  flagReasons: [{
    type: String,
    enum: [
      "grooming",          // Ley 26.904 — art. 131 CP
      "csam",              // Material abuso sexual infantil — denuncia automática
      "violence",
      "hate_speech",
      "harassment",
      "defamation",
      "spam",
      "nudity",            // si usuario no es premium +18 verificado
      "underage_content",
      "copyright",
      "other",
    ],
  }],
  flagDetail:   { type: String, default: "" },

  // ── Quién lo marcó ────────────────────────────────────
  flaggedBy:    { type: mongoose.Schema.Types.ObjectId, ref: "User" }, // null si automático
  isAutoFlag:   { type: Boolean, default: false },
  flaggedAt:    { type: Date, default: Date.now, index: true },

  // ── Estado del caso ────────────────────────────────────
  status: {
    type:    String,
    enum:    ["pending", "under_review", "removed", "dismissed", "reported_to_authorities"],
    default: "pending",
    index:   true,
  },

  // ── Acción tomada ──────────────────────────────────────
  reviewedBy:  { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  reviewedAt:  { type: Date },
  actionTaken: {
    type: String,
    enum: ["none", "removed", "user_warned", "user_suspended", "user_banned", "reported_to_authorities"],
    default: "none",
  },
  actionNote:  { type: String, default: "" },

  // ── Denuncia a autoridades (grooming/CSAM) ─────────────
  reportedToAuthorities:     { type: Boolean, default: false },
  authorityReportedAt:       { type: Date },
  authorityReportReference:  { type: String, default: "" }, // número de denuncia

  // ── Preservación de evidencia (6 meses mínimo) ────────
  // La URL de Cloudinary se mantiene en este registro aunque
  // se elimine del perfil del usuario (evidencia legal)
  preservedUntil:  { type: Date }, // 6 meses desde flaggedAt

}, { timestamps: true });

// ─── Pre-save: fijar fecha de preservación ────────────────
contentFlagSchema.pre("save", function (next) {
  if (this.isNew) {
    // 6 meses de retención mínima (ENACOM / Ley 25.326)
    this.preservedUntil = new Date(Date.now() + 6 * 30 * 24 * 60 * 60 * 1000);
  }
  next();
});

// ─── Índice compuesto para búsquedas de moderación ────────
contentFlagSchema.index({ status: 1, flaggedAt: -1 });
contentFlagSchema.index({ ownerId: 1, status: 1 });

const ContentFlag = mongoose.model("ContentFlag", contentFlagSchema);
module.exports = ContentFlag;