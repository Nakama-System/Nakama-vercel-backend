// ============================================
// NAKAMA - MIDDLEWARE DE AUTENTICACIÓN
// ============================================

const jwt = require('jsonwebtoken');
const Usuario = require('../models/Usuario');

// ─── Verificar JWT ───────────────────────────
const proteger = async (req, res, next) => {
  try {
    let token;

    if (req.headers.authorization?.startsWith('Bearer ')) {
      token = req.headers.authorization.split(' ')[1];
    }

    if (!token) {
      return res.status(401).json({ error: 'No autenticado. Por favor inicia sesión.' });
    }

    // Verificar token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Buscar usuario
    const usuario = await Usuario.findById(decoded.id).select('-password');
    if (!usuario || !usuario.activo) {
      return res.status(401).json({ error: 'El usuario no existe o fue desactivado.' });
    }

    req.usuario = usuario;
    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Sesión expirada. Inicia sesión de nuevo.' });
    }
    return res.status(401).json({ error: 'Token inválido.' });
  }
};

// ─── Verificar teléfono verificado ───────────
const requiereVerificacion = (req, res, next) => {
  if (!req.usuario.telefonoVerificado) {
    return res.status(403).json({
      error: 'Debes verificar tu número de teléfono para usar esta función.',
    });
  }
  next();
};

// ─── Verificar roles ─────────────────────────
const restringirA = (...roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.usuario.rol)) {
      return res.status(403).json({
        error: `Acceso denegado. Requiere uno de estos roles: ${roles.join(', ')}`,
      });
    }
    next();
  };
};

// ─── Verificar suscripción ───────────────────
const requiereSuscripcion = (...tipos) => {
  return (req, res, next) => {
    const { suscripcion } = req.usuario;
    const suscripcionActiva = suscripcion.activo && (!suscripcion.venceEn || suscripcion.venceEn > new Date());

    if (!tipos.includes(suscripcion.tipo) || !suscripcionActiva) {
      return res.status(403).json({
        error: `Esta función requiere suscripción: ${tipos.join(' o ')}`,
        suscripcionActual: suscripcion.tipo,
      });
    }
    next();
  };
};

// ─── Verificar rango mínimo ──────────────────
const requiereRango = (rangoMinimo) => {
  return (req, res, next) => {
    const { RANGOS } = require('../models/Usuario');
    const rangoUsuario = RANGOS.findIndex(r => r.nombre === req.usuario.rango);
    const rangoReq     = RANGOS.findIndex(r => r.nombre === rangoMinimo);

    if (rangoUsuario < rangoReq) {
      return res.status(403).json({
        error: `Necesitas el rango "${rangoMinimo}" para esto. Tu rango actual: "${req.usuario.rango}"`,
      });
    }
    next();
  };
};

// ─── Prevenir que un usuario bloqueado interactúe ──
const verificarBloqueo = async (req, res, next) => {
  try {
    const objetivoId = req.params.id;
    if (!objetivoId) return next();

    const objetivo = await Usuario.findById(objetivoId).select('usuariosBloqueados');
    if (objetivo?.usuariosBloqueados.includes(req.usuario._id)) {
      return res.status(403).json({ error: 'No puedes interactuar con este usuario.' });
    }
    next();
  } catch {
    next();
  }
};

module.exports = {
  proteger,
  requiereVerificacion,
  restringirA,
  requiereSuscripcion,
  requiereRango,
  verificarBloqueo,
};