// ═══════════════════════════════════════════════════════════
// models/BlockReport.js — Nakama
// Maneja bloqueos y reportes entre usuarios
// ═══════════════════════════════════════════════════════════
const mongoose = require("mongoose");

// ── Bloqueos ──────────────────────────────────────────────
const BlockSchema = new mongoose.Schema({
  blocker: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  blocked: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
}, { timestamps: true });

BlockSchema.index({ blocker: 1, blocked: 1 }, { unique: true });
BlockSchema.index({ blocker: 1 });
BlockSchema.index({ blocked: 1 });

// ── Reportes ──────────────────────────────────────────────
const ReportSchema = new mongoose.Schema({
  reporter:    { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  reported:    { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  chatId:      { type: mongoose.Schema.Types.ObjectId, ref: "Chat", default: null },
  messageId:   { type: mongoose.Schema.Types.ObjectId, default: null },
  reason: {
    type: String,
    enum: [
      "spam",
      "acoso",
      "contenido_inapropiado",
      "violencia",
      "odio",
      "desinformacion",
      "otro",
    ],
    required: true,
  },
  details:  { type: String, default: "" },
  status:   { type: String, enum: ["pendiente","revisado","resuelto"], default: "pendiente" },
  adminNote:{ type: String, default: "" },
}, { timestamps: true });

ReportSchema.index({ reporter: 1, reported: 1 });
ReportSchema.index({ status: 1 });

const Block  = mongoose.model("Block",  BlockSchema);
const Report = mongoose.model("Report", ReportSchema);

module.exports = { Block, Report };