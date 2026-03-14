// ═══════════════════════════════════════════════════════════
// controllers/battleController.js — Nakama  (v6)
// ═══════════════════════════════════════════════════════════

const Battle    = require("../models/Battle");
const User      = require("../models/User");
const Community = require("../models/Community");
const mongoose  = require("mongoose");

function getIO(req)  { return req.app.get("io"); }
function uid(u)      { return String(u?._id ?? u?.id ?? u); }

function buildStatePayload(battle) {
  return {
    roomId:     battle.roomId,
    nombre:     battle.nombre     ?? "",
    categorias: battle.categorias ?? [],
    players:    battle.players.map(p => ({
      userId:    String(p.userId),
      username:  p.username,
      avatarUrl: p.avatarUrl ?? null,
      status:    p.status,
      score:     p.score ?? 0,
    })),
    estado: battle.estado,
  };
}

// Calcula el level del jugador basado en victorias
function calcLevel(victorias = 0) {
  if (victorias >= 1000) return { level: 50, label: "Leyenda Suprema",  icon: "🏆" };
  if (victorias >= 800)  return { level: 45, label: "Gran Maestro",     icon: "🏆" };
  if (victorias >= 500)  return { level: 40, label: "Maestro",          icon: "🏆" };
  if (victorias >= 300)  return { level: 35, label: "Experto III",      icon: "🏆" };
  if (victorias >= 200)  return { level: 30, label: "Experto II",       icon: "🏆" };
  if (victorias >= 150)  return { level: 25, label: "Experto I",        icon: "🏆" };
  if (victorias >= 100)  return { level: 20, label: "Oro",              icon: "🥇" };
  if (victorias >= 50)   return { level: 15, label: "Plata",            icon: "🥈" };
  if (victorias >= 10)   return { level: 10, label: "Bronce",           icon: "🥉" };
  if (victorias >= 1)    return { level:  5, label: "Novato",           icon: "⚡" };
  return                        { level:  1, label: "Recién llegado",   icon: "🌱" };
}

// ════════════════════════════════════════════════════════════
// POST /battles/create
// ════════════════════════════════════════════════════════════
exports.createBattle = async (req, res) => {
  try {
    const { roomId, nombre, categorias = [], invitados = [], configuracion, communityId } = req.body;

    const rawCreatorId = req.user?._id ?? req.user?.id;
    if (!rawCreatorId) return res.status(401).json({ message: "No autenticado" });

    const creatorId  = new mongoose.Types.ObjectId(String(rawCreatorId));
    const creatorDoc = await User.findById(creatorId, "username avatarUrl victorias derrotas empates").lean();
    if (!creatorDoc) return res.status(404).json({ message: "Usuario no encontrado" });

    if (!nombre?.trim()) return res.status(400).json({ message: "nombre requerido" });

    const invitadoIds = invitados
      .map(id => String(id))
      .filter(id => mongoose.Types.ObjectId.isValid(id))
      .filter(id => id !== String(creatorId))
      .slice(0, 3);

    const invitadoDocs = invitadoIds.length > 0
      ? await User.find({ _id: { $in: invitadoIds } }, "username avatarUrl victorias derrotas empates").lean()
      : [];

    const players = [
      {
        userId:    creatorDoc._id,
        username:  creatorDoc.username,
        avatarUrl: creatorDoc.avatarUrl ?? null,
        victorias: creatorDoc.victorias ?? 0,
        derrotas:  creatorDoc.derrotas  ?? 0,
        empates:   creatorDoc.empates   ?? 0,
        status:    "accepted",
        score:     0,
        joinedAt:  new Date(),
      },
      ...invitadoDocs.map(u => ({
        userId:    u._id,
        username:  u.username,
        avatarUrl: u.avatarUrl ?? null,
        victorias: u.victorias ?? 0,
        derrotas:  u.derrotas  ?? 0,
        empates:   u.empates   ?? 0,
        status:    "pending",
        score:     0,
        joinedAt:  null,
      })),
    ];

    const battle = await Battle.create({
      roomId:      roomId || `batalla_${Date.now()}`,
      creatorId,
      communityId: communityId && mongoose.Types.ObjectId.isValid(communityId) ? communityId : null,
      nombre:      nombre.trim(),
      categorias,
      players,
      configuracion: {
        totalPreguntas:    configuracion?.totalPreguntas    ?? 10,
        tiempoPorPregunta: configuracion?.tiempoPorPregunta ?? 15,
        puntosVictoria:    configuracion?.puntosVictoria    ?? 1000,
      },
      estado:    "waiting",
      expiresAt: new Date(Date.now() + 2 * 60 * 1000),
    });

    const io = getIO(req);

    for (const u of invitadoDocs) {
      io.to(`user:${String(u._id)}`).emit("battle:invitation", {
        roomId:        battle.roomId,
        battleId:      String(battle._id),
        nombre:        battle.nombre,
        categorias:    battle.categorias,
        creadorId:     String(creatorDoc._id),
        creadorName:   creatorDoc.username,
        creadorAvatar: creatorDoc.avatarUrl ?? null,
        expiresAt:     battle.expiresAt.toISOString(),
        communityId:   battle.communityId ? String(battle.communityId) : null,
      });
    }

    if (battle.communityId) {
      io.to(`community:${String(battle.communityId)}`).emit("battle:community_challenge", {
        roomId:        battle.roomId,
        battleId:      String(battle._id),
        nombre:        battle.nombre,
        categorias:    battle.categorias,
        creadorName:   creatorDoc.username,
        creadorAvatar: creatorDoc.avatarUrl ?? null,
        invitados:     invitadoDocs.map(u => ({ userId: String(u._id), username: u.username })),
        expiresAt:     battle.expiresAt.toISOString(),
      });
    }

    res.status(201).json({ ok: true, roomId: battle.roomId, battleId: String(battle._id) });
  } catch (err) {
    console.error("[createBattle]", err);
    res.status(500).json({ message: "Error al crear la batalla" });
  }
};

// ════════════════════════════════════════════════════════════
// POST /battles/:roomId/accept
// ════════════════════════════════════════════════════════════
exports.acceptBattle = async (req, res) => {
  try {
    const userId = uid(req.user);
    const battle = await Battle.findOne({ roomId: req.params.roomId });
    if (!battle) return res.status(404).json({ message: "Sala no encontrada" });
    if (battle.estado !== "waiting") return res.status(400).json({ message: "La batalla ya comenzó o terminó" });
    if (new Date() > battle.expiresAt) return res.status(400).json({ message: "La invitación expiró" });

    const player = battle.players.find(p => String(p.userId) === userId);
    if (!player) return res.status(403).json({ message: "No estás invitado" });
    if (player.status === "accepted") return res.json({ ok: true, roomId: battle.roomId });

    player.status   = "accepted";
    player.joinedAt = new Date();
    await battle.save();

    const io           = getIO(req);
    const statePayload = buildStatePayload(battle);

    io.to(`battle:${battle.roomId}`).emit("battle:state_update", statePayload);
    io.to(`user:${String(battle.creatorId)}`).emit("battle:state_update", statePayload);
    io.to(`user:${String(battle.creatorId)}`).emit("battle:player_accepted", {
      roomId: battle.roomId, userId, username: player.username,
      estado: battle.estado, players: statePayload.players,
    });

    for (const p of battle.players) {
      io.to(`user:${String(p.userId)}`).emit("battle:player_accepted", {
        roomId: battle.roomId, userId, username: player.username,
        estado: battle.estado, players: statePayload.players,
      });
    }

    res.json({ ok: true, roomId: battle.roomId, estado: battle.estado });
  } catch (err) {
    console.error("[acceptBattle]", err);
    res.status(500).json({ message: "Error al aceptar" });
  }
};

// ════════════════════════════════════════════════════════════
// POST /battles/:roomId/decline
// ════════════════════════════════════════════════════════════
exports.declineBattle = async (req, res) => {
  try {
    const userId = uid(req.user);
    const battle = await Battle.findOne({ roomId: req.params.roomId });
    if (!battle) return res.status(404).json({ message: "Sala no encontrada" });

    const player = battle.players.find(p => String(p.userId) === userId);
    if (!player) return res.status(403).json({ message: "No estás invitado" });

    player.status = "declined";
    await battle.save();

    const io = getIO(req);
    io.to(`battle:${battle.roomId}`).emit("battle:state_update", buildStatePayload(battle));
    io.to(`user:${String(battle.creatorId)}`).emit("battle:player_declined", {
      roomId: battle.roomId, userId, username: player.username,
    });
    io.to(`user:${userId}`).emit("battle:invitation_expired", { roomId: battle.roomId });

    res.json({ ok: true });
  } catch (err) {
    console.error("[declineBattle]", err);
    res.status(500).json({ message: "Error al rechazar" });
  }
};

// ════════════════════════════════════════════════════════════
// POST /battles/:roomId/start
// ════════════════════════════════════════════════════════════
exports.startBattle = async (req, res) => {
  try {
    const userId = uid(req.user);
    const battle = await Battle.findOne({ roomId: req.params.roomId });
    if (!battle) return res.status(404).json({ message: "Sala no encontrada" });

    const isCreator = String(battle.players[0]?.userId) === userId;
    if (!isCreator) return res.status(403).json({ message: "Solo el creador puede iniciar" });

    if (battle.estado === "active") {
      const io = getIO(req);
      const statePayload = buildStatePayload(battle);
      io.to(`battle:${battle.roomId}`).emit("battle:state_update", statePayload);
      for (const p of battle.players) {
        io.to(`user:${String(p.userId)}`).emit("battle:state_update", statePayload);
      }
      return res.json({ ok: true, already: true });
    }

    if (battle.estado !== "waiting") {
      return res.status(400).json({ message: "La batalla no está en estado de espera" });
    }

    battle.estado    = "active";
    battle.startedAt = new Date();
    await battle.save();

    const io           = getIO(req);
    const statePayload = buildStatePayload(battle);
    io.to(`battle:${battle.roomId}`).emit("battle:state_update", statePayload);
    for (const p of battle.players) {
      io.to(`user:${String(p.userId)}`).emit("battle:state_update", statePayload);
    }

    console.log(`[startBattle] battle:${battle.roomId} iniciada por ${userId}`);
    res.json({ ok: true });
  } catch (err) {
    console.error("[startBattle]", err);
    res.status(500).json({ message: "Error al iniciar la batalla" });
  }
};

// ════════════════════════════════════════════════════════════
// GET /battles/:roomId
// ════════════════════════════════════════════════════════════
exports.getBattle = async (req, res) => {
  try {
    const battle = await Battle.findOne({ roomId: req.params.roomId }).lean();
    if (!battle) return res.status(404).json({ message: "Sala no encontrada" });
    res.json(battle);
  } catch (err) {
    console.error("[getBattle]", err);
    res.status(500).json({ message: "Error al obtener la sala" });
  }
};

// ════════════════════════════════════════════════════════════
// GET /battles/:roomId/result
//
// Devuelve el resultado final de una batalla con stats completos
// de cada jugador: victorias, derrotas, empates, level, winrate.
// Útil para la pantalla de resultados / BattleFinisher.
// ════════════════════════════════════════════════════════════
exports.getBattleResult = async (req, res) => {
  try {
    const battle = await Battle.findOne({ roomId: req.params.roomId }).lean();
    if (!battle) return res.status(404).json({ message: "Sala no encontrada" });

    // Enriquecer cada jugador con stats frescos desde User
    const enrichedPlayers = await Promise.all(
      battle.players.map(async (p) => {
        let userDoc = null;
        try {
          userDoc = await User.findById(p.userId, "username avatarUrl victorias derrotas empates").lean();
        } catch (_) {}

        const victorias = userDoc?.victorias ?? p.victorias ?? 0;
        const derrotas  = userDoc?.derrotas  ?? p.derrotas  ?? 0;
        const empates   = userDoc?.empates   ?? p.empates   ?? 0;
        const total     = victorias + derrotas + empates;
        const winrate   = total > 0 ? Math.round((victorias / total) * 100) : 0;
        const lvl       = calcLevel(victorias);

        return {
          userId:    String(p.userId),
          username:  userDoc?.username  ?? p.username,
          avatarUrl: userDoc?.avatarUrl ?? p.avatarUrl ?? null,
          status:    p.status,
          score:     p.score ?? 0,
          // Stats actualizados
          victorias,
          derrotas,
          empates,
          winrate,
          level:      lvl.level,
          levelLabel: lvl.label,
          levelIcon:  lvl.icon,
        };
      })
    );

    res.json({
      roomId:     battle.roomId,
      nombre:     battle.nombre     ?? "",
      categorias: battle.categorias ?? [],
      estado:     battle.estado,
      ganadorId:  battle.ganadorId  ? String(battle.ganadorId) : null,
      startedAt:  battle.startedAt  ?? null,
      finishedAt: battle.finishedAt ?? null,
      players:    enrichedPlayers,
    });
  } catch (err) {
    console.error("[getBattleResult]", err);
    res.status(500).json({ message: "Error al obtener el resultado" });
  }
};