// ═══════════════════════════════════════════════════════════
// models/EphemeralMessage.js — Nakama | Mensajes Temporales
// ═══════════════════════════════════════════════════════════

const mongoose = require("mongoose");

const recipientSchema = new mongoose.Schema({
  userId:   { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  viewed:   { type: Boolean, default: false },
  viewedAt: { type: Date,    default: null  },
}, { _id: false });

const ephemeralMessageSchema = new mongoose.Schema(
  {
    senderId: {
      type:     mongoose.Schema.Types.ObjectId,
      ref:      "User",
      required: true,
      index:    true,
    },

    // Imagen subida a Cloudinary
    imageUrl:    { type: String, required: true },
    thumbnailUrl:{ type: String, default: "" },
    caption:     { type: String, default: "", maxlength: 300 },
    mimeType:    { type: String, default: "image/jpeg" },
    size:        { type: Number, default: 0 },

    // Configuración del mensaje temporal
    config: {
      duration:    { type: Number, enum: [0, 5, 10, 30, 60], default: 10 },
      oneTimeView: { type: Boolean, default: true },
    },

    // Hasta 5 destinatarios
    recipients: {
      type:     [recipientSchema],
      validate: {
        validator: (arr) => arr.length >= 1 && arr.length <= 5,
        message:   "Debe tener entre 1 y 5 destinatarios.",
      },
    },

    // Contexto del chat de origen (para el historial)
    roomType: { type: String, enum: ["private", "group", "community"], default: "private" },
    roomId:   { type: mongoose.Schema.Types.ObjectId },

    // Estado
    destroyed:   { type: Boolean, default: false },
    destroyedAt: { type: Date,    default: null  },

    // TTL automático: si duration > 0, MongoDB elimina el doc N segundos
    // después de expiresAt usando el índice TTL de abajo.
    // Si duration === 0 (oneTimeView puro) no hay expiresAt.
    expiresAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// ── Índice TTL: borra el documento cuando expiresAt llega ──
// El campo puede ser null (en cuyo caso MongoDB lo ignora).
ephemeralMessageSchema.index(
  { expiresAt: 1 },
  { expireAfterSeconds: 0, partialFilterExpression: { expiresAt: { $ne: null } } }
);

// ── Índices de consulta ───────────────────────────────────
ephemeralMessageSchema.index({ senderId: 1, createdAt: -1 });
ephemeralMessageSchema.index({ "recipients.userId": 1, createdAt: -1 });
ephemeralMessageSchema.index({ roomId: 1 });

// ── Método: ¿todos lo vieron? → destruir ─────────────────
ephemeralMessageSchema.methods.checkAndDestroy = async function () {
  if (this.destroyed) return this;

  const allViewed = this.config.oneTimeView
    ? this.recipients.every((r) => r.viewed)
    : false;

  if (allViewed) {
    this.destroyed   = true;
    this.destroyedAt = new Date();
    this.expiresAt   = new Date(Date.now() + 30_000); // limpia en 30s
    await this.save();
  }
  return this;
};

// ── Virtuals ──────────────────────────────────────────────
ephemeralMessageSchema.virtual("isExpired").get(function () {
  return this.destroyed || (this.expiresAt && this.expiresAt <= new Date());
});

module.exports = mongoose.model("EphemeralMessage", ephemeralMessageSchema);