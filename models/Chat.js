// ═══════════════════════════════════════════════════════════
// models/Chat.js — Nakama
// ═══════════════════════════════════════════════════════════
const mongoose = require("mongoose");

const AttachmentSchema = new mongoose.Schema({
  type:         { type: String, enum: ["image","video","gif","audio","file"], default: "file" },
  url:          { type: String, required: true },
  thumbnailUrl: { type: String, default: "" },
  width:        { type: Number, default: 0 },
  height:       { type: Number, default: 0 },
  duration:     { type: Number, default: 0 },
  size:         { type: Number, default: 0 },
  mimeType:     { type: String, default: "" },
}, { _id: false });

const ReactionSchema = new mongoose.Schema({
  emoji:   { type: String, required: true },
  userIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
}, { _id: false });

const MessageSchema = new mongoose.Schema({
  sender:     { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  isReadOnly: { type: Boolean, default: false },
  text:       { type: String, default: "" },
  attachment: { type: AttachmentSchema, default: null },
  replyTo:    { type: mongoose.Schema.Types.ObjectId, ref: "Message", default: null },
  reactions:  [ReactionSchema],
  status:     { type: String, enum: ["sent","delivered","read"], default: "sent" },
  readAt:     { type: Date, default: null },
  isSystem:   { type: Boolean, default: false },
  deleted:    { type: Boolean, default: false },
  edited:     { type: Boolean, default: false },
  deletedFor: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
}, { timestamps: true });

// ── Sub-schema para miembros de grupo/comunidad ───────────
const MemberSchema = new mongoose.Schema({
  userId:   { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  role:     { type: String, enum: ["admin","moderator","member"], default: "member" },
  joinedAt: { type: Date, default: Date.now },
  muted:    { type: Boolean, default: false },
}, { _id: false });

const ChatSchema = new mongoose.Schema({
  type: {
    type:     String,
    enum:     ["p2p","grupo","comunidad"],
    required: true,
  },
  name:        { type: String, default: "" },
  avatarUrl:   { type: String, default: "" },
  description: { type: String, default: "" },
  theme:       { type: String, default: "default" },

  // p2p: exactamente 2 IDs
  participants: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],

  // grupo/comunidad
  members:    [MemberSchema],
  maxMembers: { type: Number, default: 300 },

  messages:     [MessageSchema],
  lastMessage:  { type: String, default: "" },
  lastActivity: { type: Date, default: Date.now },
  pinned:       [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
  // Contador de no leídos por usuario: { "userId": count }
  unreadCount:  { type: Map, of: Number, default: {} },
  isActive:     { type: Boolean, default: true },
}, { timestamps: true });

ChatSchema.index({ participants: 1, type: 1 });
ChatSchema.index({ "members.userId": 1 });
ChatSchema.index({ lastActivity: -1 });

module.exports = mongoose.model("Chat", ChatSchema);