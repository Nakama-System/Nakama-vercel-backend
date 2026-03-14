// ═══════════════════════════════════════════════════════════
// models/Conversation.js — Nakama
// ═══════════════════════════════════════════════════════════

const mongoose = require("mongoose");

// ─── Sub-schema: adjunto ──────────────────────────────────
const attachmentSchema = new mongoose.Schema({
  type:         { type: String, enum: ["image","video","gif","audio","file"], required: true },
  url:          { type: String, required: true },
  thumbnailUrl: { type: String, default: "" },
  width:        { type: Number, default: 0 },
  height:       { type: Number, default: 0 },
  duration:     { type: Number, default: 0 },   // segundos (audio/video)
  size:         { type: Number, default: 0 },   // bytes
  mimeType:     { type: String, default: "" },
  originalName: { type: String, default: "" },
}, { _id: false });

// ─── Sub-schema: reacción ─────────────────────────────────
const reactionSchema = new mongoose.Schema({
  emoji:   { type: String, required: true },
  userIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
}, { _id: false });

// ─── Sub-schema: mensaje ──────────────────────────────────
const messageSchema = new mongoose.Schema({
  sender: {
    type:     mongoose.Schema.Types.ObjectId,
    ref:      "User",
    required: true,
  },
  text:       { type: String, default: "" },
  attachment: { type: attachmentSchema, default: null },

  // Respuesta a otro mensaje
  replyTo: {
    type:    mongoose.Schema.Types.ObjectId,
    ref:     "Message",   // auto-referencia por ID
    default: null,
  },

  reactions: { type: [reactionSchema], default: [] },

  // Lectura
  status:  { type: String, enum: ["sent","delivered","read"], default: "sent" },
  readBy:  [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
  readAt:  { type: Date, default: null },

  // Flags
  isSystem: { type: Boolean, default: false },  // mensaje del sistema ("X se unió")
  deleted:  { type: Boolean, default: false },
  deletedFor: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],  // borrado solo para mí
  deletedAt:  { type: Date },
  deletedBy:  { type: mongoose.Schema.Types.ObjectId, ref: "User" },
}, {
  timestamps: true,
});

// ─── Sub-schema: miembro de grupo/comunidad ───────────────
const memberSchema = new mongoose.Schema({
  userId: {
    type:     mongoose.Schema.Types.ObjectId,
    ref:      "User",
    required: true,
  },
  role:     { type: String, enum: ["admin","moderator","member"], default: "member" },
  joinedAt: { type: Date, default: Date.now },
  muted:    { type: Boolean, default: false },
  mutedUntil: { type: Date, default: null },
  banned:   { type: Boolean, default: false },
  bannedAt: { type: Date },
  banReason:{ type: String, default: "" },
  banExpiresAt: { type: Date, default: null },
}, { _id: false });

// ═══════════════════════════════════════════════════════════
// Schema principal: Conversation
// ═══════════════════════════════════════════════════════════
const conversationSchema = new mongoose.Schema({

  // ── Tipo de sala ───────────────────────────────────────
  // "private"   = P2P encriptado entre dos usuarios
  // "group"     = grupo (hasta N miembros según rol)
  // "community" = comunidad pública/privada grande
  roomType: {
    type:     String,
    enum:     ["private","group","community"],
    required: true,
    index:    true,
  },

  // ── Identidad ──────────────────────────────────────────
  name:        { type: String, default: "", maxlength: 100 },
  description: { type: String, default: "", maxlength: 500 },
  avatarUrl:   { type: String, default: "" },
  theme:       { type: String, default: "default" },

  // ── Participantes ──────────────────────────────────────
  // Para "private": exactamente 2 userIds (sin roles)
  participants: [{
    type:  mongoose.Schema.Types.ObjectId,
    ref:   "User",
  }],

  // Para "group" y "community": array con roles
  members: { type: [memberSchema], default: [] },

  // ── Mensajes ───────────────────────────────────────────
  // Embebidos para P2P y grupos pequeños.
  // Para comunidades grandes se puede migrar a colección separada.
  messages: { type: [messageSchema], default: [] },

  // Caché del último mensaje (para la lista de conversaciones)
  lastMessage:     { type: String, default: "" },
  lastMessageAt:   { type: Date,   default: null },
  lastMessageFrom: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },

  // Contador de no leídos por usuario { userId: count }
  unreadCount: {
    type:    Map,
    of:      Number,
    default: {},
  },

  // ── Configuraciones ────────────────────────────────────
  maxMembers: { type: Number, default: 300 },
  isPrivate:  { type: Boolean, default: false },  // comunidad privada = requiere aprobación
  isArchived: { type: Boolean, default: false },
  deleted:    { type: Boolean, default: false },

  // Usuarios que lo tienen pinneado / silenciado
  pinnedBy: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
  mutedBy:  [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],

  // Tags para comunidades
  tags: [{ type: String, maxlength: 30 }],

  // Admins (acceso rápido sin recorrer members[])
  admins: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],

}, {
  timestamps: true,
  toJSON:     { virtuals: true },
  toObject:   { virtuals: true },
});

// ─── Índices ──────────────────────────────────────────────
conversationSchema.index({ participants: 1 });
conversationSchema.index({ "members.userId": 1 });
conversationSchema.index({ roomType: 1, deleted: 1 });
conversationSchema.index({ lastMessageAt: -1 });

// Índice único para P2P: evita duplicar salas entre el mismo par
conversationSchema.index(
  { participants: 1 },
  {
    unique: true,
    partialFilterExpression: { roomType: "private" },
    name: "unique_private_room",
  }
);

// ─── Virtuals ─────────────────────────────────────────────
conversationSchema.virtual("memberCount").get(function () {
  if (this.roomType === "private") return 2;
  return this.members?.length ?? 0;
});

// ─── Métodos de instancia ─────────────────────────────────

// Agregar mensaje y actualizar caché
conversationSchema.methods.addMessage = async function (msgData) {
  this.messages.push(msgData);
  const saved = this.messages[this.messages.length - 1];

  this.lastMessage     = msgData.text?.slice(0, 100) || "[media]";
  this.lastMessageAt   = new Date();
  this.lastMessageFrom = msgData.sender;

  // Incrementar unread para todos menos el sender
  const allIds = this.roomType === "private"
    ? this.participants.map(String)
    : this.members.map(m => String(m.userId));

  for (const uid of allIds) {
    if (uid === String(msgData.sender)) continue;
    this.unreadCount.set(uid, (this.unreadCount.get(uid) ?? 0) + 1);
  }

  await this.save();
  return saved;
};

// Marcar como leído para un usuario
conversationSchema.methods.markRead = async function (userId) {
  this.unreadCount.set(String(userId), 0);
  // Marcar mensajes no leídos
  const uid = String(userId);
  let changed = false;
  for (const msg of this.messages) {
    if (String(msg.sender) !== uid && !msg.readBy.map(String).includes(uid)) {
      msg.readBy.push(userId);
      if (msg.readBy.length >= (this.roomType === "private" ? 2 : this.members.length)) {
        msg.status = "read";
        msg.readAt = new Date();
      } else {
        msg.status = "delivered";
      }
      changed = true;
    }
  }
  if (changed) await this.save();
};

// Verificar si un userId es miembro
conversationSchema.methods.isMember = function (userId) {
  const uid = String(userId);
  if (this.roomType === "private") {
    return this.participants.map(String).includes(uid);
  }
  return this.members.some(m => String(m.userId) === uid && !m.banned);
};

// Obtener rol de un miembro
conversationSchema.methods.getMemberRole = function (userId) {
  const uid = String(userId);
  if (this.roomType === "private") return "member";
  return this.members.find(m => String(m.userId) === uid)?.role ?? null;
};

module.exports = mongoose.model("Conversation", conversationSchema);