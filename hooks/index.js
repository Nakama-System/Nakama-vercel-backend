// ============================================
// NAKAMA - CAPA DE SOCKET.IO
// ============================================

const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const Usuario = require('./models/Usuario');
const Mensaje = require('./models/Mensaje');
const Grupo = require('./models/Grupo');

let io;

// Mapa de usuarios conectados: userId -> socketId
const usuariosConectados = new Map();

// ─── Inicialización ──────────────────────────
const initSocket = (server) => {
  io = new Server(server, {
    cors: {
      origin:      process.env.CLIENT_URL || 'http://localhost:3000',
      credentials: true,
    },
    pingTimeout: 60000,
  });

  // ─── Middleware de autenticación ─────────
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth.token || socket.handshake.headers.authorization?.split(' ')[1];
      if (!token) return next(new Error('No autorizado: token faltante'));

      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const usuario = await Usuario.findById(decoded.id).select('-password');

      if (!usuario || !usuario.activo) return next(new Error('No autorizado: usuario inválido'));
      if (!usuario.telefonoVerificado)  return next(new Error('Verifica tu teléfono primero'));

      socket.usuario = usuario;
      next();
    } catch {
      next(new Error('Token inválido o expirado'));
    }
  });

  // ─── Conexión ────────────────────────────
  io.on('connection', (socket) => {
    const userId = socket.usuario._id.toString();
    console.log(`🟢 Usuario conectado: ${socket.usuario.nombreUsuario} (${socket.id})`);

    // Registrar conexión
    usuariosConectados.set(userId, socket.id);
    actualizarEstadoConexion(userId, true);

    // Notificar a seguidores que el usuario está en línea
    socket.broadcast.emit('usuario:online', { userId, nombreUsuario: socket.usuario.nombreUsuario });

    // ─── Unirse a rooms de grupos ─────────
    socket.on('grupos:unirse', async () => {
      try {
        const grupos = await Grupo.find({ 'miembros.usuario': userId }).select('_id');
        grupos.forEach(g => socket.join(`grupo_${g._id}`));
      } catch (err) {
        socket.emit('error', { mensaje: 'Error al unirse a grupos.' });
      }
    });

    // ─── CHAT PRIVADO ─────────────────────
    socket.on('mensaje:privado', async (datos) => {
      try {
        const { destinatarioId, contenido, tipo = 'texto', metadata = {} } = datos;

        // Verificar bloqueos
        const destinatario = await Usuario.findById(destinatarioId).select('usuariosBloqueados');
        if (destinatario?.usuariosBloqueados.includes(userId)) {
          return socket.emit('error', { mensaje: 'No puedes enviar mensajes a este usuario.' });
        }

        // Generar chatId consistente (siempre en el mismo orden)
        const ids = [userId, destinatarioId].sort();
        const chatId = `privado_${ids[0]}_${ids[1]}`;

        const mensaje = await Mensaje.create({
          remitente:    userId,
          destinatario: destinatarioId,
          chatId,
          tipoChat:     'privado',
          tipo,
          contenido,
          metadata,
          entregado: false,
        });

        const mensajePopulado = await Mensaje.findById(mensaje._id)
          .populate('remitente', 'nombreUsuario avatarURL rango');

        // Enviar al destinatario si está conectado
        const socketDestinatario = usuariosConectados.get(destinatarioId);
        if (socketDestinatario) {
          io.to(socketDestinatario).emit('mensaje:nuevo', mensajePopulado);
          // Marcar como entregado
          await Mensaje.findByIdAndUpdate(mensaje._id, { entregado: true });
        }

        // Confirmar al remitente
        socket.emit('mensaje:enviado', mensajePopulado);

      } catch (err) {
        socket.emit('error', { mensaje: 'Error al enviar mensaje.' });
      }
    });

    // ─── CHAT GRUPAL ──────────────────────
    socket.on('mensaje:grupo', async (datos) => {
      try {
        const { grupoId, contenido, tipo = 'texto', metadata = {} } = datos;

        const grupo = await Grupo.findById(grupoId);
        if (!grupo) return socket.emit('error', { mensaje: 'Grupo no encontrado.' });

        const esMiembro = grupo.miembros.some(m => m.usuario.toString() === userId);
        if (!esMiembro) return socket.emit('error', { mensaje: 'No eres miembro de este grupo.' });

        // Verificar si el grupo es solo admins
        if (grupo.soloAdmins && !grupo.admins.includes(userId)) {
          return socket.emit('error', { mensaje: 'Solo los admins pueden enviar mensajes aquí.' });
        }

        const chatId = `grupo_${grupoId}`;
        const mensaje = await Mensaje.create({
          remitente: userId,
          chatId,
          tipoChat:  'grupo',
          tipo,
          contenido,
          metadata,
          entregado: true,
        });

        const mensajePopulado = await Mensaje.findById(mensaje._id)
          .populate('remitente', 'nombreUsuario avatarURL rango');

        // Emitir a todo el grupo
        io.to(chatId).emit('mensaje:nuevo', mensajePopulado);

      } catch (err) {
        socket.emit('error', { mensaje: 'Error al enviar mensaje al grupo.' });
      }
    });

    // ─── ESTADO DE LECTURA ────────────────
    socket.on('mensaje:leido', async ({ mensajeId }) => {
      try {
        await Mensaje.findByIdAndUpdate(mensajeId, {
          $addToSet: { leidoPor: userId },
        });
        const mensaje = await Mensaje.findById(mensajeId);
        if (mensaje) {
          const socketRemitente = usuariosConectados.get(mensaje.remitente.toString());
          if (socketRemitente) {
            io.to(socketRemitente).emit('mensaje:actualizado', {
              mensajeId,
              leidoPor: mensaje.leidoPor,
            });
          }
        }
      } catch {}
    });

    // ─── INDICADOR "ESCRIBIENDO..." ───────
    socket.on('escribiendo', ({ chatId }) => {
      socket.to(chatId).emit('escribiendo', {
        userId,
        nombreUsuario: socket.usuario.nombreUsuario,
        chatId,
      });
    });

    socket.on('dejoDeEscribir', ({ chatId }) => {
      socket.to(chatId).emit('dejoDeEscribir', { userId, chatId });
    });

    // ─── DESCONEXIÓN ──────────────────────
    socket.on('disconnect', () => {
      console.log(`🔴 Usuario desconectado: ${socket.usuario.nombreUsuario}`);
      usuariosConectados.delete(userId);
      actualizarEstadoConexion(userId, false);
      socket.broadcast.emit('usuario:offline', { userId });
    });
  });

  console.log('⚡ Socket.io inicializado');
  return io;
};

// ─── Helpers ────────────────────────────────
const actualizarEstadoConexion = async (userId, enLinea) => {
  await Usuario.findByIdAndUpdate(userId, {
    enLinea,
    ultimaConexion: new Date(),
  }).catch(() => {});
};

const getIO = () => {
  if (!io) throw new Error('Socket.io no inicializado');
  return io;
};

const estaConectado = (userId) => usuariosConectados.has(userId.toString());

module.exports = { initSocket, getIO, estaConectado, usuariosConectados };