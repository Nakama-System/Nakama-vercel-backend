// ============================================
// NAKAMA - SERVICIO DE AUTENTICACIÓN
// ============================================

const jwt = require('jsonwebtoken');
const { admin } = require('../config/firebase');
const Usuario = require('../models/Usuario');

// ─── Generar tokens JWT ──────────────────────
const generarTokens = (id) => {
  const token = jwt.sign({ id }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  });
  const refreshToken = jwt.sign({ id }, process.env.JWT_REFRESH_SECRET, {
    expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '30d',
  });
  return { token, refreshToken };
};

// ─── Formatear respuesta de usuario ─────────
const formatearUsuario = (usuario) => ({
  id:                 usuario._id,
  nombreUsuario:      usuario.nombreUsuario,
  nombre:             usuario.nombre,
  email:              usuario.email,
  telefono:           usuario.telefono,
  avatarURL:          usuario.avatarURL,
  rango:              usuario.rango,
  cantidadSeguidores: usuario.cantidadSeguidores,
  rol:                usuario.rol,
  suscripcion:        usuario.suscripcion.tipo,
  telefonoVerificado: usuario.telefonoVerificado,
  googleVinculado:    usuario.googleVinculado,
});

// ─── REGISTRO ────────────────────────────────
const registrar = async ({ telefono, email, nombreUsuario, password, terminosAceptados, firebaseUID }) => {
  // Verificar duplicados
  const existente = await Usuario.findOne({
    $or: [{ email }, { telefono }, { nombreUsuario }],
  });

  if (existente) {
    if (existente.email === email)             throw new Error('EMAIL_DUPLICADO');
    if (existente.telefono === telefono)       throw new Error('TELEFONO_DUPLICADO');
    if (existente.nombreUsuario === nombreUsuario) throw new Error('USERNAME_DUPLICADO');
  }

  const usuario = await Usuario.create({
    telefono,
    email,
    nombreUsuario,
    password,
    firebaseUID,
    terminosAceptados: terminosAceptados === true || terminosAceptados === 'true',
    telefonoVerificado: false,
  });

  const { token, refreshToken } = generarTokens(usuario._id);
  return { usuario: formatearUsuario(usuario), token, refreshToken };
};

// ─── VERIFICAR OTP FIREBASE ──────────────────
// El cliente hace la verificación OTP en Firebase y nos manda el idToken resultante
const verificarOTP = async (idToken) => {
  // Verificar el token de Firebase
  const decoded = await admin.auth().verifyIdToken(idToken);

  if (!decoded.phone_number) {
    throw new Error('El token no contiene número de teléfono.');
  }

  const telefono = decoded.phone_number;
  const usuario = await Usuario.findOne({ telefono });

  if (!usuario) {
    throw new Error('No existe una cuenta con ese número. Regístrate primero.');
  }

  // Marcar teléfono como verificado
  usuario.telefonoVerificado = true;
  usuario.firebaseUID = decoded.uid;
  await usuario.save();

  const { token, refreshToken } = generarTokens(usuario._id);
  return { usuario: formatearUsuario(usuario), token, refreshToken };
};

// ─── LOGIN CON GOOGLE ────────────────────────
const loginGoogle = async (idToken) => {
  const decoded = await admin.auth().verifyIdToken(idToken);

  if (!decoded.email) throw new Error('El token de Google no contiene email.');

  let usuario = await Usuario.findOne({ email: decoded.email });

  if (!usuario) {
    // Crear cuenta parcial (sin teléfono aún)
    // El usuario deberá vincular su teléfono después
    throw new Error('REGISTRAR_CON_TELEFONO');
  }

  // Vincular Google si no estaba vinculado
  if (!usuario.googleVinculado) {
    usuario.googleVinculado = true;
    usuario.firebaseUID = decoded.uid;
    if (!usuario.avatarURL && decoded.picture) {
      usuario.avatarURL = decoded.picture;
    }
    await usuario.save();
  }

  if (!usuario.telefonoVerificado) {
    const { token } = generarTokens(usuario._id);
    return {
      usuario: formatearUsuario(usuario),
      token,
      requiereVerificacionTelefono: true,
    };
  }

  const { token, refreshToken } = generarTokens(usuario._id);
  return { usuario: formatearUsuario(usuario), token, refreshToken };
};

// ─── LOGIN CON TELÉFONO+OTP ──────────────────
// Mismo flujo que verificarOTP pero retorna info de login
const loginTelefono = async (idToken) => {
  return verificarOTP(idToken);
};

module.exports = {
  generarTokens,
  formatearUsuario,
  registrar,
  verificarOTP,
  loginGoogle,
  loginTelefono,
};