// ═══════════════════════════════════════════════════════════
// models/ChatUpload.js — Nakama | Uploaded files in chat
// ═══════════════════════════════════════════════════════════

const mongoose = require("mongoose");

const chatUploadSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref:  "User",
      required: true,
      index: true,
    },

    // Cloudinary data
    url: {
      type:     String,
      required: true,
    },
    thumbnailUrl: {
      type: String,
    },
    clippedUrl: {
      type: String,  // video clips only
    },
    publicId: {
      type: String,  // for future deletion
    },

    // File metadata
    type: {
      type:     String,
      enum:     ["image", "video", "gif", "audio", "file"],
      required: true,
    },
    mimeType: {
      type: String,
    },
    size: {
      type: Number,  // bytes
    },
    width:    Number,
    height:   Number,
    duration: Number,  // seconds (video/audio)

    // Optional: linked message
    messageId: {
      type: mongoose.Schema.Types.ObjectId,
      ref:  "Message",
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

// Index for user's upload history
chatUploadSchema.index({ userId: 1, createdAt: -1 });

module.exports = mongoose.model("ChatUpload", chatUploadSchema);