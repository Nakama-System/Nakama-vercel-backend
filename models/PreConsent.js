const mongoose = require("mongoose");

const PreConsentSchema = new mongoose.Schema({
  birthDate:        { type: String,  required: true },
  parentalConsent:  { type: Boolean, default: false },
  termsAccepted:    { type: Boolean, required: true },
  privacyAccepted:  { type: Boolean, required: true },
  antiGroomingAck:  { type: Boolean, required: true },
  consentTimestamp: { type: String,  required: true },
  consentIp:        { type: String,  required: true },
  userAgent:        { type: String },
  termsVersion:     { type: String,  default: "1.0" },
  privacyVersion:   { type: String,  default: "1.0" },
  expiresAt:        { type: Date,    required: true },
  used:             { type: Boolean, default: false },
});

// TTL index: Mongo borra automáticamente los documentos expirados
PreConsentSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model("PreConsent", PreConsentSchema);
