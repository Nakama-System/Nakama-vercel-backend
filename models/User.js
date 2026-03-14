// ═══════════════════════════════════════════════════════════
// models/User.js — Nakama (COMPLETO Y CORREGIDO)
// ═══════════════════════════════════════════════════════════

const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

// ─── Rangos ───────────────────────────────────────────────
const RANGOS = [
  { minSeguidores: 0, nombre: "Aspirante" },
  { minSeguidores: 100, nombre: "Estrella Naciente" },
  { minSeguidores: 300, nombre: "Portador del Rayo" },
  { minSeguidores: 1000, nombre: "Guerrero Élite" },
  { minSeguidores: 2000, nombre: "Cristal Legendario" },
  { minSeguidores: 5000, nombre: "Samurái Supremo" },
  { minSeguidores: 10000, nombre: "Maestro Nakama" },
  { minSeguidores: 20000, nombre: "Señor del Aura" },
  { minSeguidores: 25000, nombre: "Comandante Supremo" },
  { minSeguidores: 50000, nombre: "Dragón Ascendido" },
  { minSeguidores: 100000, nombre: "Leyenda Inmortal" },
  { minSeguidores: 500000, nombre: "Emperador Nakama" },
];

function calcularRango(n) {
  let rango = RANGOS[0].nombre;
  for (const nivel of RANGOS) {
    if (n >= nivel.minSeguidores) rango = nivel.nombre;
    else break;
  }
  return rango;
}

// ─── Sub-schema: video de perfil ─────────────────────────
const profileVideoSchema = new mongoose.Schema(
  {
    url: { type: String },
    publicId: { type: String },
    thumbnailUrl: { type: String },
    duration: { type: Number },
    sizeBytes: { type: Number },
    flagged: { type: Boolean, default: false },
    flagReason: { type: String, default: "" },
    flaggedAt: { type: Date },
    removedAt: { type: Date },
    removedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    uploadedAt: { type: Date, default: Date.now },
  },
  { _id: false },
);

// ─── Sub-schema: consentimiento legal ────────────────────
const legalConsentSchema = new mongoose.Schema(
  {
    termsVersion: { type: String },
    privacyVersion: { type: String },
    consentIp: { type: String },
    consentTs: { type: Date },
    userAgent: { type: String },
    parentalConsent: { type: Boolean, default: false },
    birthDate: { type: Date },
  },
  { _id: false },
);

// ─── Sub-schema: acción de moderación ────────────────────
const moderationActionSchema = new mongoose.Schema(
  {
    action: {
      type: String,
      enum: ["warn", "suspend", "ban", "unban", "unsuspend", "content_removed"],
      required: true,
    },
    reason: { type: String, required: true },
    detail: { type: String, default: "" },
    performedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    performedAt: { type: Date, default: Date.now },
    expiresAt: { type: Date },
    contentRef: { type: String },
  },
  { _id: true },
);

// ─── Sub-schema: contacto en agenda ──────────────────────
const contactEntrySchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    alias: { type: String, default: "", maxlength: 50 },
    notes: { type: String, default: "", maxlength: 500 },
    source: {
      type: String,
      enum: ["nakama", "instagram", "tiktok", "facebook", "manual"],
      default: "nakama",
    },
    savedAt: { type: Date, default: Date.now },
  },
  { _id: false },
);

// ─── Sub-schema: notificación del sistema ────────────────
const notificationSchema = new mongoose.Schema(
  {
    title:      { type: String, default: "Mensaje de Nakama" },
    body:       { type: String, default: "" },
    type:       { type: String, default: "admin" },
    icon:       { type: String, default: "🔔" },
    link:       { type: String, default: "/chat" },
    chatId:     { type: mongoose.Schema.Types.ObjectId, ref: "Chat" },
    read:       { type: Boolean, default: false },
    fromSystem: { type: Boolean, default: false },
    createdAt:  { type: Date, default: Date.now },
  },
  { _id: true },
);

// ═══════════════════════════════════════════════════════════
// Schema Principal
// ═══════════════════════════════════════════════════════════
const userSchema = new mongoose.Schema(
  {
    // ── Identidad ──────────────────────────────────────────
    username: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      minlength: 3,
      maxlength: 30,
      match: [
        /^[a-zA-Z0-9_.]+$/,
        "Solo letras, números, puntos y guiones bajos",
      ],
      index: true,
    },
    reveal:         { type: String, default: null },
    sessionVersion: { type: Number, default: 0 },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      match: [/^\S+@\S+\.\S+$/, "Email inválido"],
      index: true,
    },
    password: {
      type: String,
      select: false,
    },

    // ── Perfil ─────────────────────────────────────────────
    displayName:    { type: String, trim: true, maxlength: 50, default: "" },
    bio:            { type: String, maxlength: 300, default: "" },
    avatarUrl:      { type: String, default: "" },
    avatarPublicId: { type: String, default: "" },
    profileVideo:   { type: profileVideoSchema, default: null },
    blogUrl:        { type: String, default: "" },
    birthDate:      { type: Date },

    // ── Rol / Suscripción ──────────────────────────────────
    role: {
      type: String,
      enum: ["user", "user-pro", "user-premium", "moderator", "admin", "superadmin"],
      default: "user",
      index: true,
    },
    subscription: {
      type:      { type: String, enum: ["free", "pro", "premium"], default: "free" },
      expiresAt: { type: Date },
      active:    { type: Boolean, default: true },
    },

    // ── Social ─────────────────────────────────────────────
    followers:      [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    following:      [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    followersCount: { type: Number, default: 0, index: true },
    followingCount: { type: Number, default: 0 },
    rank:           { type: String, default: "Aspirante" },
    blockedUsers:   [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],

    // ── Agenda de contactos ────────────────────────────────
    contacts: { type: [contactEntrySchema], default: [] },

    // ── Redes sociales vinculadas ──────────────────────────
    socialLinks: {
      instagram: { type: String, default: "" },
      tiktok:    { type: String, default: "" },
      facebook:  { type: String, default: "" },
    },

    // ── Video mensual ──────────────────────────────────────
    videoMonthlyLog: {
      month: { type: Number },
      year:  { type: Number },
      count: { type: Number, default: 0 },
    },

    // ── Stats de batalla ──────────────────────────────────
    victorias: { type: Number, default: 0 },
    derrotas:  { type: Number, default: 0 },
    empates:   { type: Number, default: 0 },

    // ── Moderación / Ban / Suspend ─────────────────────────
    isBanned:   { type: Boolean, default: false, index: true },
    banReason:  { type: String, default: "" },
    bannedAt:   { type: Date },
    bannedBy:   { type: mongoose.Schema.Types.ObjectId, ref: "User" },

    isSuspended:   { type: Boolean, default: false, index: true },
    suspendReason: { type: String, default: "" },
    suspendedAt:   { type: Date },
    suspendedBy:   { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    suspendUntil:  { type: Date },

    moderationHistory: { type: [moderationActionSchema], default: [] },

    flaggedContent: [
      {
        type:      { type: String, enum: ["video", "post", "comment", "avatar"] },
        contentId: { type: String },
        reason:    { type: String },
        flaggedAt: { type: Date, default: Date.now },
        removedAt: { type: Date },
        removedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        autoFlag:  { type: Boolean, default: false },
      },
    ],

    warningCount: { type: Number, default: 0 },

    // ── Notificaciones del sistema ─────────────────────────
    // Persistidas por _sendSystemMessage (usersController)
    // Leídas por GET /chats/notifications
    notifications: { type: [notificationSchema], default: [] },

    // ── Consentimiento legal ───────────────────────────────
    legalConsent: { type: legalConsentSchema, default: null },

    termsHistory: [
      {
        termsVersion:   { type: String },
        privacyVersion: { type: String },
        acceptedAt:     { type: Date, default: Date.now },
        acceptedIp:     { type: String },
        acceptedUA:     { type: String },
      },
    ],

    acceptedTermsVersion:   { type: String, default: "1.0" },
    acceptedPrivacyVersion: { type: String, default: "1.0" },
    pendingTermsAcceptance: { type: Boolean, default: false, index: true },
    pendingTermsVersion:    { type: String, default: "" },

    // ── Estado ─────────────────────────────────────────────
    isOnline:  { type: Boolean, default: false },
    isActive:  { type: Boolean, default: true },
    lastSeenAt:{ type: Date },

    // ── Auth Google ────────────────────────────────────────
    googleId:     { type: String, sparse: true, index: true },
    googleLinked: { type: Boolean, default: false },

    // ── Reset de contraseña ────────────────────────────────
    passwordResetTokenHash:   { type: String, select: false },
    passwordResetTokenExpiry: { type: Date },
  },
  {
    timestamps: true,
    toJSON:     { virtuals: true },
    toObject:   { virtuals: true },
  },
);

// ─── Índices compuestos ───────────────────────────────────
userSchema.index({ isBanned: 1, isSuspended: 1 });
userSchema.index({ pendingTermsAcceptance: 1 });
userSchema.index({ "socialLinks.instagram": 1 });
userSchema.index({ "socialLinks.tiktok": 1 });
userSchema.index({ "socialLinks.facebook": 1 });

// ─── Virtual: ¿suspensión activa? ────────────────────────
userSchema.virtual("isCurrentlySuspended").get(function () {
  if (!this.isSuspended) return false;
  if (!this.suspendUntil) return true;
  return new Date() < this.suspendUntil;
});

// ─── Pre-save: hash password ──────────────────────────────
userSchema.pre("save", async function (next) {
  if (!this.isModified("password") || !this.password) return next();
  if (this.password.startsWith("$2b$") || this.password.startsWith("$2a$"))
    return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

// ─── Pre-save: calcular rango ─────────────────────────────
userSchema.pre("save", function (next) {
  if (this.isModified("followersCount")) {
    this.rank = calcularRango(this.followersCount);
  }
  next();
});

// ─── Métodos de instancia ─────────────────────────────────
userSchema.methods.comparePassword = async function (plain) {
  if (!this.password) return false;
  return bcrypt.compare(plain, this.password);
};

userSchema.methods.canUploadVideo = function () {
  const limits = { user: 1, "user-pro": 6, "user-premium": 30 };
  const limit  = limits[this.role] ?? 1;
  const now    = new Date();
  const log    = this.videoMonthlyLog;
  if (!log || log.month !== now.getMonth() + 1 || log.year !== now.getFullYear())
    return true;
  return log.count < limit;
};

userSchema.methods.registerVideoUpload = function () {
  const now   = new Date();
  const month = now.getMonth() + 1;
  const year  = now.getFullYear();
  if (
    !this.videoMonthlyLog ||
    this.videoMonthlyLog.month !== month ||
    this.videoMonthlyLog.year  !== year
  ) {
    this.videoMonthlyLog = { month, year, count: 1 };
  } else {
    this.videoMonthlyLog.count += 1;
  }
};

userSchema.methods.applyBan = async function (reason, performedBy, detail = "") {
  this.isBanned    = true;
  this.banReason   = reason;
  this.bannedAt    = new Date();
  this.bannedBy    = performedBy;
  this.isSuspended = false;
  this.moderationHistory.push({ action: "ban", reason, detail, performedBy });
  await this.save();
};

userSchema.methods.applySuspension = async function (
  reason,
  performedBy,
  until  = null,
  detail = "",
) {
  this.isSuspended   = true;
  this.suspendReason = reason;
  this.suspendedAt   = new Date();
  this.suspendedBy   = performedBy;
  this.suspendUntil  = until;
  this.moderationHistory.push({
    action: "suspend",
    reason,
    detail,
    performedBy,
    expiresAt: until,
  });
  await this.save();
};

userSchema.methods.flagContent = async function (
  type,
  contentId,
  reason,
  removedBy,
  auto = false,
) {
  this.flaggedContent.push({
    type,
    contentId,
    reason,
    flaggedAt: new Date(),
    removedAt: new Date(),
    removedBy,
    autoFlag: auto,
  });
  this.moderationHistory.push({
    action:      "content_removed",
    reason,
    detail:      `${type} id:${contentId}`,
    performedBy: removedBy,
    contentRef:  contentId,
  });
  await this.save();
};

// ─── Métodos estáticos ────────────────────────────────────
userSchema.statics.calcularRango = calcularRango;
userSchema.statics.RANGOS        = RANGOS;

module.exports = mongoose.model("User", userSchema);