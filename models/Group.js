// ═══════════════════════════════════════════════════════════
// models/Group.js — Nakama | Grupos y Salas de Interés
//
// Reglas de negocio:
//   - El creador (owner) NUNCA puede ser eliminado del grupo
//   - Solo user-pro y user-premium pueden hacer el grupo público/privado
//   - Cualquier user puede CREAR una sala de interés
//   - El dueño puede banear, dar/quitar rol admin
//   - Admins pueden banear pero no pueden tocar al owner ni a otros admins
// ═══════════════════════════════════════════════════════════

const mongoose = require("mongoose");

// ─── Sub-schema: miembro del grupo ────────────────────────
const MemberSchema = new mongoose.Schema(
  {
    user: {
      type:     mongoose.Schema.Types.ObjectId,
      ref:      "User",
      required: true,
    },
    // Rol dentro del grupo (independiente del rol global)
    role: {
      type:    String,
      enum:    ["member", "admin", "owner"],
      default: "member",
    },
    joinedAt:  { type: Date, default: Date.now },
    // Silenciado: no recibe notificaciones
    muted:     { type: Boolean, default: false },
    mutedUntil: { type: Date, default: null },
  },
  { _id: false }
);

// ─── Sub-schema: usuario baneado ──────────────────────────
const BanSchema = new mongoose.Schema(
  {
    user:     { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    reason:   { type: String, default: "" },
    bannedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    bannedAt: { type: Date, default: Date.now },
    // null = ban permanente
    expiresAt: { type: Date, default: null },
  },
  { _id: false }
);

// ─── Schema principal ─────────────────────────────────────
const GroupSchema = new mongoose.Schema(
  {
    name: {
      type:      String,
      required:  [true, "El nombre del grupo es obligatorio"],
      trim:      true,
      maxlength: 60,
    },
    description: {
      type:      String,
      default:   "",
      maxlength: 300,
    },
    // Avatar / imagen de portada del grupo
    avatarUrl:  { type: String, default: "" },
    avatarPublicId: { type: String, default: "" },
    coverUrl:   { type: String, default: "" },

    // ── Tipo de grupo
    // "interest" = sala de interés (puede crear cualquier user)
    // "group"    = grupo de chat normal
    type: {
      type:    String,
      enum:    ["interest", "group"],
      default: "group",
    },

    // ── Visibilidad
    // SOLO user-pro y user-premium pueden cambiar esto
    visibility: {
      type:    String,
      enum:    ["public", "private"],
      default: "public",
    },

    // ── Categorías / etiquetas (para salas de interés)
    tags: [{ type: String, maxlength: 30 }],

    // ── El creador original — NUNCA puede ser eliminado
    owner: {
      type:     mongoose.Schema.Types.ObjectId,
      ref:      "User",
      required: true,
    },

    // ── Miembros activos
    members: [MemberSchema],

    // ── Baneados
    banned: [BanSchema],

    // ── Anuncio de entrada
    // Si true, cuando alguien entra se manda un mensaje de sistema
    announceJoin: { type: Boolean, default: true },

    // ── El dueño puede eliminar el grupo permanentemente
    isDeleted:  { type: Boolean, default: false },
    deletedAt:  { type: Date,    default: null },

    // ── Último mensaje (para ordenar la lista de grupos)
    lastMessage: {
      text:      { type: String, default: "" },
      sender:    { type: mongoose.Schema.Types.ObjectId, ref: "User" },
      sentAt:    { type: Date, default: Date.now },
    },

    // ── Conteo de mensajes no leídos (por miembro)
    // Se calcula en runtime, no se guarda aquí
  },
  { timestamps: true }
);

// ─── Índices ──────────────────────────────────────────────
GroupSchema.index({ owner: 1 });
GroupSchema.index({ "members.user": 1 });
GroupSchema.index({ type: 1, visibility: 1 });
GroupSchema.index({ tags: 1 });
GroupSchema.index({ isDeleted: 1 });

// ─── Método: verificar si un user es miembro ─────────────
GroupSchema.methods.isMember = function (userId) {
  return this.members.some(m => m.user.toString() === userId.toString());
};

// ─── Método: obtener rol de un user en el grupo ──────────
GroupSchema.methods.getMemberRole = function (userId) {
  const m = this.members.find(m => m.user.toString() === userId.toString());
  return m?.role ?? null;
};

// ─── Método: verificar si un user está baneado ───────────
GroupSchema.methods.isBanned = function (userId) {
  return this.banned.some(b => {
    if (b.user.toString() !== userId.toString()) return false;
    if (!b.expiresAt) return true; // ban permanente
    return new Date() < b.expiresAt;
  });
};

// ─── Método: puede cambiar visibilidad ───────────────────
// Solo el owner y admins con rol pro/premium
GroupSchema.methods.canToggleVisibility = function (user) {
  const role = this.getMemberRole(user._id);
  if (!["owner", "admin"].includes(role)) return false;
  return ["user-pro", "user-premium", "superadmin"].includes(user.role);
};

module.exports = mongoose.model("Group", GroupSchema);