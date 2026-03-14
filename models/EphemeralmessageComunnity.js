const mongoose = require("mongoose");

const RecipientSchema = new mongoose.Schema(
  {
    userId:   { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    viewed:   { type: Boolean, default: false },
    viewedAt: { type: Date,    default: null },
  },
  { _id: false },
);

const EphemeralConfigSchema = new mongoose.Schema(
  {
    duration:    { type: Number,  default: 0 },
    oneTimeView: { type: Boolean, default: true },
  },
  { _id: false },
);

const EphemeralMessageSchema = new mongoose.Schema(
  {
    senderId: {
      type:     mongoose.Schema.Types.ObjectId,
      ref:      "User",
      required: true,
    },

    // FIXED: imageUrl y thumbnailUrl son opcionales.
    // Los temporales de solo texto no tienen imagen.
    imageUrl: {
      type:    String,
      required: false,
      default: null,
    },
    thumbnailUrl: {
      type:    String,
      required: false,
      default: null,
    },

    caption: {
      type:      String,
      default:   "",
      maxlength: 500,
    },

    mimeType: {
      type:    String,
      default: "text/plain",
    },
    size: {
      type:    Number,
      default: 0,
    },

    config: {
      type:    EphemeralConfigSchema,
      default: () => ({ duration: 0, oneTimeView: true }),
    },

    recipients: [RecipientSchema],

    // Para comunidades
    roomType: {
      type: String,
      enum: ["community", "private", "group"],
      default: null,
    },
    roomId: {
      type:    mongoose.Schema.Types.ObjectId,
      default: null,
    },

    // Estado
    destroyed:   { type: Boolean, default: false },
    destroyedAt: { type: Date,    default: null },
    expiresAt:   { type: Date,    default: null },
  },
  { timestamps: true },
);

// ── Índices ──────────────────────────────────────────────
EphemeralMessageSchema.index({ senderId: 1 });
EphemeralMessageSchema.index({ roomType: 1, roomId: 1, createdAt: -1 });
EphemeralMessageSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// ── Método helper para destruir tras la primera vista ────
EphemeralMessageSchema.methods.checkAndDestroy = async function () {
  if (this.destroyed) return this;
  if (this.config?.oneTimeView) {
    this.destroyed   = true;
    this.destroyedAt = new Date();
    await this.save();
  }
  return this;
};

module.exports = mongoose.model("EphemeralMessageCommunity", EphemeralMessageSchema);