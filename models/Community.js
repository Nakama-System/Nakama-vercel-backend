// ═══════════════════════════════════════════════════════════
// models/Community.js — Nakama  (FIXED: slug sparse + unique)
// ═══════════════════════════════════════════════════════════

const mongoose = require("mongoose");

const memberSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    username: { type: String, default: "" },
    avatarUrl: { type: String, default: "" },
    role: { type: String, enum: ["admin", "member"], default: "member" },
    hasStar: { type: Boolean, default: false },
    frameColor: {
      type: String,
      enum: [
        "none",
        "red",
        "blue",
        "green",
        "gold",
        "purple",
        "black",
        "orange",
      ],
      default: "none",
    },
    frozen: { type: Boolean, default: false },
    frozenUntil: { type: String, default: null }, // ISO string o "permanent"
    msgCount: { type: Number, default: 0 },
    joinedAt: { type: Date, default: Date.now },
  },
  { _id: false },
);

const messageSchema = new mongoose.Schema({
  senderId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  text: { type: String, default: "" },
  isSystem: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now },
});

const communitySchema = new mongoose.Schema({
  name:          { type: String, required: true, trim: true, maxlength: 80 },
  description:   { type: String, default: "", maxlength: 500 },
  avatarUrl:     { type: String, default: null },
  coverUrl:      { type: String, default: null },
  creatorId:     { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  memberCount:   { type: Number, default: 0 },
  likeCount:     { type: Number, default: 0 },
  likes:         [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
  messagingOpen: { type: Boolean, default: true },
  rules:         { type: String, default: "" },
  
  // ← AGREGAR ESTO:
  theme: {
    type:    String,
    enum:    ["dark","light","ocean","forest","sunset","sakura","neon","gold","galaxy"],
    default: "dark",
  },

  bannedUsers: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
  members: [memberSchema],
  unreadCounts: { type: Map, of: Number, default: {} },
}, { timestamps: true });

// ── Índices ───────────────────────────────────────────────
communitySchema.index({ name: "text" });
communitySchema.index({ creatorId: 1 });
communitySchema.index({ "members.userId": 1 });

// ── FIX: slug unique pero SPARSE (ignora nulls) ───────────
//    Esto reemplaza el índice slug_1 problemático.
//    Si ya existe el índice en Mongo, el script de migración
//    más abajo lo elimina y lo recrea correctamente.
communitySchema.index(
  { slug: 1 },
  { unique: true, sparse: true }, // sparse = no indexa documentos donde slug es null
);

module.exports = mongoose.model("Community", communitySchema);
