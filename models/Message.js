// ═══════════════════════════════════════════════════════════
// models/Message.js — Nakama | Mensajes
//
// Unifica mensajes de:
//   - Chats privados (tipo "private")
//   - Grupos (tipo "group")
//   - Comunidades (tipo "community")
//
// Soporta: texto, imagen, gif, video
// ═══════════════════════════════════════════════════════════

const mongoose = require("mongoose");

// ─── Sub-schema: adjunto multimedia ───────────────────────
const AttachmentSchema = new mongoose.Schema(
  {
    type:       { type: String, enum: ["image", "gif", "video"], required: true },
    url:        { type: String, required: true },  // URL de Cloudinary
    publicId:   { type: String, required: true },  // Para poder borrarlo
    thumbnailUrl: { type: String, default: "" },   // Para videos
    width:      { type: Number, default: 0 },
    height:     { type: Number, default: 0 },
    duration:   { type: Number, default: 0 },      // Segundos (solo video)
    size:       { type: Number, default: 0 },      // Bytes
    mimeType:   { type: String, default: "" },
  },
  { _id: false }
);

// ─── Schema principal ─────────────────────────────────────
const MessageSchema = new mongoose.Schema(
  {
    // ── Origen
    sender: {
      type:     mongoose.Schema.Types.ObjectId,
      ref:      "User",
      required: true,
    },

    // ── Destino (uno de los tres, según roomType)
    roomType: {
      type:    String,
      enum:    ["private", "group", "community"],
      required: true,
    },
    // Para "private": ID del otro usuario
    // Para "group": ID del grupo
    // Para "community": ID de la comunidad
    roomId: {
      type:     mongoose.Schema.Types.ObjectId,
      required: true,
      // ref se resuelve dinámicamente según roomType
    },

    // ── Contenido
    text: {
      type:      String,
      default:   "",
      maxlength: 4000,
    },
    attachment: AttachmentSchema,

    // ── Estado del mensaje
    // delivered: llegó al servidor
    // read: fue visto por el/los destinatario(s)
    status: {
      type:    String,
      enum:    ["sent", "delivered", "read"],
      default: "sent",
    },

    // Para chats privados: cuándo lo leyó el otro
    readAt: { type: Date, default: null },

    // ── Respuesta a otro mensaje (reply/quote)
    replyTo: {
      type:    mongoose.Schema.Types.ObjectId,
      ref:     "Message",
      default: null,
    },

    // ── Reacciones (emoji + array de userIds)
    reactions: [
      {
        emoji:   { type: String },
        userIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
        _id: false,
      },
    ],

    // ── Borrado suave
    deletedFor: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref:  "User",
      },
    ],
    deletedForAll: { type: Boolean, default: false },

    // ── Mensaje del sistema (ej: "Juan entró al grupo")
    isSystem: { type: Boolean, default: false },
  },
  { timestamps: true }
);

// ─── Índices ──────────────────────────────────────────────
MessageSchema.index({ roomType: 1, roomId: 1, createdAt: -1 });
MessageSchema.index({ sender: 1 });
MessageSchema.index({ roomId: 1, createdAt: -1 });

module.exports = mongoose.model("Message", MessageSchema);