// ═══════════════════════════════════════════════════════════
// models/Battle.js — Nakama
// ═══════════════════════════════════════════════════════════

const mongoose = require("mongoose");

const playerSchema = new mongoose.Schema(
  {
    userId:    { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    username:  { type: String, default: "" },
    avatarUrl: { type: String, default: null },
    victorias: { type: Number, default: 0 },
    derrotas:  { type: Number, default: 0 },
    empates:   { type: Number, default: 0 },
    // pending | accepted | declined
    status:    { type: String, enum: ["pending", "accepted", "declined"], default: "pending" },
    score:     { type: Number, default: 0 },
    joinedAt:  { type: Date, default: null },
  },
  { _id: false },
);

const battleSchema = new mongoose.Schema(
  {
    roomId: { type: String, required: true, unique: true },

    // Quién creó la sala
    creatorId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },

    // Comunidad de origen (opcional — si viene de una comunidad)
    communityId: { type: mongoose.Schema.Types.ObjectId, ref: "Community", default: null },

    nombre:     { type: String, required: true, maxlength: 80 },
    categorias: [{ type: String }],

    // Todos los jugadores (creador + invitados)
    players: [playerSchema],

    // waiting | active | finished | cancelled
    estado: {
      type:    String,
      enum:    ["waiting", "active", "finished", "cancelled"],
      default: "waiting",
    },

    // Configuración de la partida
    configuracion: {
      totalPreguntas:    { type: Number, default: 10 },
      tiempoPorPregunta: { type: Number, default: 15 },
      puntosVictoria:    { type: Number, default: 1000 },
    },

    // Expira si los invitados no aceptan en 2 minutos
    expiresAt: { type: Date, required: true },

    ganadorId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true },
);

battleSchema.index({ roomId: 1 });
battleSchema.index({ creatorId: 1 });
battleSchema.index({ "players.userId": 1 });
battleSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 }); // TTL index

module.exports = mongoose.model("Battle", battleSchema);