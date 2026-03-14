// backend/models/Movie.js
const mongoose = require("mongoose");

const VoteSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  rating: { type: Number, min: 1, max: 5, required: true },
}, { _id: false });

const MovieSchema = new mongoose.Schema({
  title:        { type: String, required: true, trim: true },
  description:  { type: String, default: "", trim: true },
  thumbnail:    { type: String, default: "" },
  videoUrl:     { type: String, required: true },
  year:         { type: Number, required: true },
  duration:     { type: String, default: "" },
  category: {
    type: String,
    enum: [
      "accion", "aventura", "comedia", "drama", "terror",
      "romance", "sci-fi", "animacion", "documental",
      "diversion", "amor", "familia", "otro",
    ],
    default: "otro",
    required: true,
    index: true,
  },
  // ── Clasificación por edad ────────────────────────────
  ageRating: {
    type:    String,
    enum:    ["all", "+10", "+13", "+18"],
    default: "all",
    index:   true,
  },
  // ─────────────────────────────────────────────────────
  canDownload:  { type: Boolean, default: false },
  isPublished:  { type: Boolean, default: true, index: true },
  slug:         { type: String, unique: true, sparse: true },
  publicUrl:    { type: String, default: "" },
  tags:         [String],
  views:        { type: Number, default: 0 },
  votes:        [VoteSchema],
  votesCount:   { type: Number, default: 0 },
  rating:       { type: Number, default: 0, min: 0, max: 5 },
}, {
  timestamps: true,
  toJSON:   { virtuals: true },
  toObject: { virtuals: true },
});

MovieSchema.index({ title: "text", description: "text" });

MovieSchema.virtual("publicUrlVirtual").get(function () {
  const base = process.env.FRONTEND_URL || "https://nakama.app";
  return `${base}/pelicula/${this.slug || this._id}`;
});

MovieSchema.pre("save", function (next) {
  if (this.votes?.length) {
    const sum       = this.votes.reduce((a, v) => a + v.rating, 0);
    this.rating     = parseFloat((sum / this.votes.length).toFixed(1));
    this.votesCount = this.votes.length;
  }

  if (this.duration !== undefined && this.duration !== null) {
    this.duration = String(this.duration).trim();
  }

  next();
});

MovieSchema.methods.hasVoted = function (userId) {
  return this.votes.some(v => String(v.userId) === String(userId));
};

MovieSchema.methods.addVote = async function (userId, rating) {
  if (this.hasVoted(userId)) throw new Error("Ya votaste esta película");
  this.votes.push({ userId, rating });
  return this.save();
};

module.exports = mongoose.model("Movie", MovieSchema);