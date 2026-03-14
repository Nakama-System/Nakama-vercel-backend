// ═══════════════════════════════════════════════════════════
// controllers/passwordController.js — Nakama | Reset Password
// ═══════════════════════════════════════════════════════════

const crypto   = require("crypto");
const jwt      = require("jsonwebtoken");
const User     = require("../models/User");
const { sendResetPasswordEmail } = require("../services/emailService");

const JWT_RESET_SECRET = process.env.JWT_RESET_SECRET || "nakama_reset_dev";
const CLIENT_URL       = process.env.CLIENT_URL        || "http://localhost:3000";

// ═══════════════════════════════════════════════════════════
// POST /auth/forgot-password
// Recibe: { email }
// ═══════════════════════════════════════════════════════════
exports.forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ success: false, message: "El email es obligatorio." });
    }

    const user = await User.findOne({ email: email.toLowerCase().trim() });

    // Siempre responder OK para no revelar si el email existe
    if (!user) {
      return res.json({
        success: true,
        message: "Si ese email está registrado, recibirás un enlace para restablecer tu contraseña.",
      });
    }

    // Generar token seguro con expiración de 1 hora
    const resetToken = jwt.sign(
      { id: user._id, purpose: "reset" },
      JWT_RESET_SECRET,
      { expiresIn: "1h" }
    );

    // Guardar hash del token en el usuario
    const tokenHash = crypto.createHash("sha256").update(resetToken).digest("hex");
    await User.updateOne(
      { _id: user._id },
      {
        $set: {
          passwordResetTokenHash:    tokenHash,
          passwordResetTokenExpiry:  new Date(Date.now() + 60 * 60 * 1000),
        },
      }
    );

    const resetUrl = `${CLIENT_URL}/reset-password?token=${resetToken}`;
    await sendResetPasswordEmail(user.email, user.username, resetUrl);

    return res.json({
      success: true,
      message: "Si ese email está registrado, recibirás un enlace para restablecer tu contraseña.",
    });
  } catch (err) {
    console.error("[forgotPassword]", err);
    return res.status(500).json({ success: false, message: "Error interno del servidor." });
  }
};

// ═══════════════════════════════════════════════════════════
// POST /auth/reset-password
// Recibe: { token, password }
// ═══════════════════════════════════════════════════════════
exports.resetPassword = async (req, res) => {
  try {
    const { token, password } = req.body;

    if (!token || !password) {
      return res.status(400).json({ success: false, message: "Token y nueva contraseña son obligatorios." });
    }
    if (password.length < 8) {
      return res.status(400).json({ success: false, message: "La contraseña debe tener al menos 8 caracteres." });
    }

    // Verificar JWT
    let payload;
    try {
      payload = jwt.verify(token, JWT_RESET_SECRET);
    } catch {
      return res.status(401).json({ success: false, message: "El enlace expiró o es inválido. Solicitá uno nuevo." });
    }

    if (payload.purpose !== "reset") {
      return res.status(401).json({ success: false, message: "Token inválido." });
    }

    // Verificar hash
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    const user = await User.findOne({
      _id:                         payload.id,
      passwordResetTokenHash:      tokenHash,
      passwordResetTokenExpiry:    { $gt: new Date() },
    });

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "El enlace ya fue usado o expiró. Solicitá uno nuevo.",
      });
    }

    // Actualizar contraseña — el pre-save hook la hashea
    user.password = password;
    user.passwordResetTokenHash   = undefined;
    user.passwordResetTokenExpiry = undefined;
    await user.save();

    return res.json({ success: true, message: "Contraseña actualizada correctamente. Ya podés iniciar sesión." });
  } catch (err) {
    console.error("[resetPassword]", err);
    return res.status(500).json({ success: false, message: "Error interno del servidor." });
  }
};