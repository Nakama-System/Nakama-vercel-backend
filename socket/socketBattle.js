// ═══════════════════════════════════════════════════════════
// socket/socketBattle.js — Nakama  (v7 — fix declined players)
// ═══════════════════════════════════════════════════════════
//
// FIXES v7:
// 1. [BUG CRÍTICO] battle:player_done ahora ignora jugadores con status
//    "declined" en el conteo total. Antes esperaba N player_done donde N
//    era battle.players.length (todos), pero los declined nunca emiten
//    player_done, por lo que la batalla quedaba colgada infinitamente
//    en waiting_game_over cuando alguien rechazaba la invitación.
//    Fix: totalCount = activePlayers.length (solo no-declined).
// ═══════════════════════════════════════════════════════════

const Battle = require("../models/Battle");
const User   = require("../models/User");

const gameRooms = new Map();

function getOrCreateRoom(roomId) {
  if (!gameRooms.has(roomId)) {
    gameRooms.set(roomId, {
      questions: [],
      answers:   new Map(),
      done:      new Set(),
      autoTimer: null,
      started:   false,
    });
  }
  return gameRooms.get(roomId);
}

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

function calcQuestionResults(room, qIndex, players) {
  return players.map(p => {
    const uid    = String(p.userId);
    const answer = room.answers.get(uid)?.get(qIndex);
    return {
      userId:   uid,
      correcto: answer?.correcto ?? false,
      pts:      answer?.pts      ?? 0,
      tiempo:   answer?.tiempo   ?? 0,
      opcion:   answer?.opcion   ?? null,
    };
  });
}

async function emitGameStart(io, roomId) {
  io.to(`battle:${roomId}`).emit("battle:game_start");
  try {
    const battle = await Battle.findOne({ roomId }).lean();
    if (battle?.players) {
      for (const p of battle.players) {
        io.to(`user:${String(p.userId)}`).emit("battle:game_start", { roomId });
      }
    }
  } catch (e) {
    console.error("[emitGameStart] DB error:", e);
  }
}

async function updateUserStats({ tipo, winnerId = null, loserId = null, playerIds = [], tiedIds = [], restIds = [] }) {
  try {
    if (tipo === "win" && winnerId) {
      await User.findByIdAndUpdate(winnerId, { $inc: { victorias: 1 } });
      const losers = playerIds.filter(id => String(id) !== String(winnerId));
      if (losers.length > 0) {
        await User.updateMany({ _id: { $in: losers } }, { $inc: { derrotas: 1 } });
      }
    }
    if (tipo === "pact" && playerIds.length > 0) {
      await User.updateMany({ _id: { $in: playerIds } }, { $inc: { empates: 1 } });
    }
    if (tipo === "reject" && winnerId && loserId) {
      await User.findByIdAndUpdate(winnerId, { $inc: { victorias: 1 } });
      await User.findByIdAndUpdate(loserId,  { $inc: { derrotas:  1 } });
    }
    if (tipo === "multi_tie" && tiedIds.length > 0) {
      await User.updateMany({ _id: { $in: tiedIds } }, { $inc: { empates:  1 } });
      if (restIds.length > 0) {
        await User.updateMany({ _id: { $in: restIds } }, { $inc: { derrotas: 1 } });
      }
    }
    console.log(`[updateUserStats] tipo:${tipo} ok.`);
  } catch (e) {
    console.error("[updateUserStats]", e);
  }
}

// ════════════════════════════════════════════════════════════
module.exports = function registerBattleSocket(socket, io) {
  const userId   = String(socket.user._id ?? socket.user.id);
  const username = socket.user.username;

  // ─────────────────────────────────────────────────────────
  // battle:join  (LOBBY)
  // ─────────────────────────────────────────────────────────
  socket.on("battle:join", async ({ roomId }, ack) => {
    try {
      if (!roomId) return ack?.({ ok: false, error: "roomId requerido" });
      const battle = await Battle.findOne({ roomId });
      if (!battle) return ack?.({ ok: false, error: "Sala no encontrada" });
      const isPlayer = battle.players.some(p => String(p.userId) === userId);
      if (!isPlayer) return ack?.({ ok: false, error: "No sos parte de esta batalla" });

      socket.join(`battle:${roomId}`);
      console.log(`[socketBattle] ${username} joined lobby battle:${roomId}`);
      socket.to(`battle:${roomId}`).emit("battle:player_online", { userId, username });

      const payload = buildStatePayload(battle);
      ack?.({ ok: true, battle: payload });
      io.to(`battle:${roomId}`).emit("battle:state_update", payload);

      if (battle.estado === "active") {
        const room = getOrCreateRoom(roomId);
        socket.emit("battle:state_update", payload);
        if (room.started) {
          socket.emit("battle:game_start", { roomId });
          if (room.questions.length > 0) {
            socket.emit("battle:game_questions", { questions: room.questions });
          }
        }
      }
    } catch (err) {
      console.error("[battle:join]", err);
      ack?.({ ok: false, error: "Error interno" });
    }
  });

  // ─────────────────────────────────────────────────────────
  // battle:ready  (LOBBY)
  // ─────────────────────────────────────────────────────────
  socket.on("battle:ready", async ({ roomId }, ack) => {
    try {
      if (!roomId) return ack?.({ ok: false, error: "roomId requerido" });
      const battle = await Battle.findOne({ roomId });
      if (!battle) return ack?.({ ok: false, error: "Sala no encontrada" });
      const player = battle.players.find(p => String(p.userId) === userId);
      if (!player) return ack?.({ ok: false, error: "No sos parte de esta batalla" });

      player.status = "accepted";
      await battle.save();
      console.log(`[socketBattle] ${username} ready en battle:${roomId}`);

      const statePayload = buildStatePayload(battle);
      io.to(`battle:${roomId}`).emit("battle:state_update", statePayload);
      io.to(`user:${String(battle.players[0]?.userId)}`).emit("battle:state_update", statePayload);
      ack?.({ ok: true });
    } catch (err) {
      console.error("[battle:ready]", err);
      ack?.({ ok: false, error: "Error interno" });
    }
  });

  // ─────────────────────────────────────────────────────────
  // battle:start  (LOBBY — fallback por socket)
  // ─────────────────────────────────────────────────────────
  socket.on("battle:start", async ({ roomId }, ack) => {
    try {
      if (!roomId) return ack?.({ ok: false, error: "roomId requerido" });
      const battle = await Battle.findOne({ roomId });
      if (!battle) return ack?.({ ok: false, error: "Sala no encontrada" });
      const isCreator = String(battle.players[0]?.userId) === userId;
      if (!isCreator) return ack?.({ ok: false, error: "Solo el creador puede iniciar" });

      if (battle.estado === "active") {
        const payload = buildStatePayload(battle);
        io.to(`battle:${roomId}`).emit("battle:state_update", payload);
        for (const p of battle.players) {
          io.to(`user:${String(p.userId)}`).emit("battle:state_update", payload);
        }
        return ack?.({ ok: true, already: true });
      }

      battle.estado    = "active";
      battle.startedAt = new Date();
      await battle.save();
      console.log(`[socketBattle] battle:${roomId} iniciada (socket) por ${username}`);

      const payload = buildStatePayload(battle);
      io.to(`battle:${roomId}`).emit("battle:state_update", payload);
      for (const p of battle.players) {
        io.to(`user:${String(p.userId)}`).emit("battle:state_update", payload);
      }
      ack?.({ ok: true });
    } catch (err) {
      console.error("[battle:start]", err);
      ack?.({ ok: false, error: "Error interno" });
    }
  });

  // ─────────────────────────────────────────────────────────
  // battle:join_game  (JUEGO)
  // ─────────────────────────────────────────────────────────
  socket.on("battle:join_game", async ({ roomId }) => {
    try {
      socket.join(`battle:${roomId}`);
      console.log(`[socketBattle] ${username} joined game battle:${roomId}`);
      const room = getOrCreateRoom(roomId);
      if (room.questions.length > 0) {
        socket.emit("battle:game_questions", { questions: room.questions });
      }
      if (room.started) {
        socket.emit("battle:game_start", { roomId });
      }
    } catch (err) {
      console.error("[battle:join_game]", err);
    }
  });

  // ─────────────────────────────────────────────────────────
  // battle:set_questions  (JUEGO — solo creador)
  // ─────────────────────────────────────────────────────────
  socket.on("battle:set_questions", async ({ roomId, questions }) => {
    try {
      const battle = await Battle.findOne({ roomId });
      if (!battle) return;
      const isCreator = String(battle.players[0]?.userId) === userId;
      if (!isCreator) return;

      const room     = getOrCreateRoom(roomId);
      room.questions = questions;
      io.to(`battle:${roomId}`).emit("battle:game_questions", { questions });

      if (room.autoTimer) { clearTimeout(room.autoTimer); room.autoTimer = null; }

      room.autoTimer = setTimeout(async () => {
        room.autoTimer = null;
        if (room.started) return;
        room.started = true;
        try {
          await Battle.updateOne({ roomId }, { $set: { estado: "active", startedAt: new Date() } });
        } catch (e) {
          console.error("[battle:set_questions auto-start DB]", e);
        }
        console.log(`[socketBattle] auto-inicio battle:${roomId}`);
        await emitGameStart(io, roomId);
      }, 15_000);

      console.log(`[socketBattle] preguntas seteadas en battle:${roomId} (auto-inicio en 15s)`);
    } catch (err) {
      console.error("[battle:set_questions]", err);
    }
  });

  // ─────────────────────────────────────────────────────────
  // battle:creator_start  (JUEGO — inicio inmediato)
  // ─────────────────────────────────────────────────────────
  socket.on("battle:creator_start", async ({ roomId, questions }) => {
    try {
      const battle = await Battle.findOne({ roomId });
      if (!battle) return;
      const isCreator = String(battle.players[0]?.userId) === userId;
      if (!isCreator) return;

      const room = getOrCreateRoom(roomId);
      if (room.autoTimer) { clearTimeout(room.autoTimer); room.autoTimer = null; }
      if (room.started) return;
      room.started = true;

      if (questions?.length) {
        room.questions = questions;
        io.to(`battle:${roomId}`).emit("battle:game_questions", { questions: room.questions });
        for (const p of battle.players) {
          io.to(`user:${String(p.userId)}`).emit("battle:game_questions", { questions: room.questions });
        }
      }

      try {
        await Battle.updateOne({ roomId }, { $set: { estado: "active", startedAt: new Date() } });
      } catch (e) {
        console.error("[battle:creator_start DB]", e);
      }

      console.log(`[socketBattle] creador inició battle:${roomId}`);
      await emitGameStart(io, roomId);
    } catch (err) {
      console.error("[battle:creator_start]", err);
    }
  });

  // ─────────────────────────────────────────────────────────
  // battle:answer  (JUEGO)
  // ─────────────────────────────────────────────────────────
  socket.on("battle:answer", async ({ roomId, qIndex, userId: uid, opcion, tiempo, correcto, pts }) => {
    try {
      const answerId = uid || userId;
      const room     = getOrCreateRoom(roomId);

      if (!room.answers.has(answerId)) room.answers.set(answerId, new Map());
      if (room.answers.get(answerId).has(qIndex)) return;

      room.answers.get(answerId).set(qIndex, { opcion, tiempo, correcto, pts });

      socket.to(`battle:${roomId}`).emit("battle:player_answered", {
        userId: answerId, correcto, pts, tiempo, opcion,
      });

      if (pts > 0) {
        Battle.updateOne(
          { roomId, "players.userId": answerId },
          { $inc: { "players.$.score": pts } }
        ).catch(e => console.error("[battle:answer] score inc:", e));
      }

      try {
        const battle = await Battle.findOne({ roomId });
        if (!battle) return;
        // Solo verificar entre jugadores activos
        const activePl = battle.players.filter(p => p.status !== "declined");
        const allAnswered = activePl.every(p =>
          room.answers.get(String(p.userId))?.has(qIndex)
        );
        if (allAnswered) {
          const results = calcQuestionResults(room, qIndex, activePl);
          io.to(`battle:${roomId}`).emit("battle:question_done", { qIndex, results });
        }
      } catch (e) {
        console.error("[battle:answer] check all answered:", e);
      }
    } catch (err) {
      console.error("[battle:answer]", err);
    }
  });

  // ─────────────────────────────────────────────────────────
  // battle:player_done  (JUEGO)
  //
  // FIX v7:
  //   - totalCount usa solo jugadores activos (no declined).
  //   - Los declined nunca emiten player_done, así que antes la batalla
  //     quedaba colgada para siempre si alguien rechazó la invitación.
  // ─────────────────────────────────────────────────────────
  socket.on("battle:player_done", async ({ roomId, userId: uid }) => {
    try {
      const doneId = uid || userId;
      const room   = getOrCreateRoom(roomId);
      room.done.add(doneId);

      const battle = await Battle.findOne({ roomId });
      if (!battle) return;

      // ✅ FIX: Solo contar jugadores activos (excluir declined)
      const activePlayers    = battle.players.filter(p => p.status !== "declined");
      const totalCount       = activePlayers.length;
      const doneCount        = [...room.done].filter(id =>
        activePlayers.some(p => String(p.userId) === id)
      ).length;
      const pendingUsers     = activePlayers.filter(p => !room.done.has(String(p.userId)));
      const pendingUsernames = pendingUsers.map(p => p.username);

      console.log(
        `[socketBattle] battle:${roomId} — ${doneCount}/${totalCount} activos terminaron.` +
        ` (declined: ${battle.players.length - totalCount})` +
        ` Faltan: ${pendingUsernames.join(", ") || "nadie"}`
      );

      io.to(`battle:${roomId}`).emit("battle:player_done_ack", {
        doneUserId: doneId,
        doneCount,
        totalCount,
        pendingUsernames,
      });

      if (doneCount < totalCount) return;

      // ── Scores finales reales (solo activos) ────────────
      const finalPlayers = activePlayers.map(p => {
        const uid2 = String(p.userId);
        let total  = 0;
        room.answers.get(uid2)?.forEach(ans => { total += ans.pts ?? 0; });
        return {
          userId:    uid2,
          username:  p.username,
          avatarUrl: p.avatarUrl ?? null,
          status:    p.status,
          score:     total,
        };
      });

      const sorted    = [...finalPlayers].sort((a, b) => b.score - a.score);
      const topScore  = sorted[0]?.score ?? 0;
      const tiedGroup = sorted.filter(p => p.score === topScore);
      const allTied   = tiedGroup.length === finalPlayers.length;

      let winnerId = null;
      let statTipo;

      if (allTied) {
        statTipo = "pact";
      } else if (tiedGroup.length === 1) {
        winnerId = tiedGroup[0].userId;
        statTipo = "win";
      } else {
        statTipo = "multi_tie";
      }

      // ── Persistir en BD ─────────────────────────────────
      try {
        await Battle.updateOne({ roomId }, {
          $set: {
            estado:     "finished",
            finishedAt: new Date(),
            ganadorId:  winnerId,
            players:    battle.players.map(p => {
              const fp = finalPlayers.find(x => x.userId === String(p.userId));
              return { ...p.toObject(), score: fp?.score ?? p.score };
            }),
          },
        });
      } catch (e) {
        console.error("[battle:player_done] DB update:", e);
      }

      // ── Actualizar stats ────────────────────────────────
      const allPlayerIds = finalPlayers.map(p => p.userId);
      if (statTipo === "win") {
        await updateUserStats({ tipo: "win", winnerId, playerIds: allPlayerIds });
      } else if (statTipo === "pact") {
        await updateUserStats({ tipo: "pact", playerIds: allPlayerIds });
      } else {
        const tiedIds = tiedGroup.map(p => p.userId);
        const restIds = sorted.filter(p => p.score < topScore).map(p => p.userId);
        await updateUserStats({ tipo: "multi_tie", tiedIds, restIds });
      }

      console.log(
        `[socketBattle] battle:${roomId} terminada. tipo:${statTipo} ` +
        `Ganador: ${winnerId ?? "empate"}. ` +
        `Scores: ${finalPlayers.map(p => `${p.username}:${p.score}`).join(", ")}`
      );

      // ── Emitir game_over — room + user rooms personales ─
      const gameOverPayload = { players: finalPlayers, winnerId };
      io.to(`battle:${roomId}`).emit("battle:game_over", gameOverPayload);
      for (const p of finalPlayers) {
        io.to(`user:${p.userId}`).emit("battle:game_over", gameOverPayload);
      }

      gameRooms.delete(roomId);
    } catch (err) {
      console.error("[battle:player_done]", err);
    }
  });

  // ─────────────────────────────────────────────────────────
  // DUEL HANDLERS
  // ─────────────────────────────────────────────────────────
  socket.on("battle:duel_propose_fight", async ({ roomId }) => {
    try {
      const battle = await Battle.findOne({ roomId });
      if (!battle) return;
      const isCreator = String(battle.players[0]?.userId) === userId;
      if (!isCreator) return;
      const payload = { roomId };
      io.to(`battle:${roomId}`).emit("battle:duel_fight_proposed", payload);
      for (const p of battle.players) {
        io.to(`user:${String(p.userId)}`).emit("battle:duel_fight_proposed", payload);
      }
    } catch (err) {
      console.error("[battle:duel_propose_fight]", err);
    }
  });

  socket.on("battle:duel_propose_pact", async ({ roomId }) => {
    try {
      const battle = await Battle.findOne({ roomId });
      if (!battle) return;
      const isCreator = String(battle.players[0]?.userId) === userId;
      if (!isCreator) return;

      const playerIds = battle.players.map(p => String(p.userId));
      try {
        await Battle.updateOne({ roomId }, {
          $set: {
            estado:     "finished",
            finishedAt: new Date(),
            ganadorId:  null,
            players:    battle.players.map(p => ({ ...p.toObject(), score: 750 })),
          },
        });
      } catch (e) {
        console.error("[battle:duel_propose_pact] DB update:", e);
      }

      await updateUserStats({ tipo: "pact", playerIds });
      const payload = { roomId };
      io.to(`battle:${roomId}`).emit("battle:duel_pact_proposed", payload);
      for (const p of battle.players) {
        io.to(`user:${String(p.userId)}`).emit("battle:duel_pact_proposed", payload);
      }
    } catch (err) {
      console.error("[battle:duel_propose_pact]", err);
    }
  });

  socket.on("battle:duel_accept", async ({ roomId }) => {
    try {
      const battle = await Battle.findOne({ roomId });
      if (!battle) return;
      try {
        await Battle.updateOne({ roomId }, {
          $set: {
            estado:  "active",
            players: battle.players.map(p => ({ ...p.toObject(), score: 0 })),
          },
        });
      } catch (e) {
        console.error("[battle:duel_accept] DB update:", e);
      }

      const room   = getOrCreateRoom(roomId);
      room.done    = new Set();
      room.answers = new Map();

      const payload = { roomId };
      io.to(`battle:${roomId}`).emit("battle:duel_accepted", payload);
      for (const p of battle.players) {
        io.to(`user:${String(p.userId)}`).emit("battle:duel_accepted", payload);
      }
    } catch (err) {
      console.error("[battle:duel_accept]", err);
    }
  });

  socket.on("battle:set_questions_rematch", async ({ roomId, questions }) => {
    try {
      const battle = await Battle.findOne({ roomId });
      if (!battle) return;
      const isCreator = String(battle.players[0]?.userId) === userId;
      if (!isCreator) return;

      const room     = getOrCreateRoom(roomId);
      room.questions = questions;
      io.to(`battle:${roomId}`).emit("battle:rematch_questions", { questions });
      for (const p of battle.players) {
        io.to(`user:${String(p.userId)}`).emit("battle:rematch_questions", { questions });
      }
    } catch (err) {
      console.error("[battle:set_questions_rematch]", err);
    }
  });

  socket.on("battle:duel_reject", async ({ roomId, loserId }) => {
    try {
      const battle = await Battle.findOne({ roomId });
      if (!battle) return;

      const winnerPlayer = battle.players.find(p => String(p.userId) !== String(loserId));
      const winnerId     = winnerPlayer ? String(winnerPlayer.userId) : null;
      console.log(`[socketBattle] duel_reject en battle:${roomId}, pierde: ${loserId}`);

      try {
        await Battle.updateOne({ roomId }, {
          $set: { estado: "finished", finishedAt: new Date(), ganadorId: winnerId },
        });
      } catch (e) {
        console.error("[battle:duel_reject] DB update:", e);
      }

      await updateUserStats({ tipo: "reject", winnerId, loserId: String(loserId) });
      io.to(`user:${String(loserId)}`).emit("battle:invitation_expired", { roomId });

      const payload = { roomId, loserId };
      io.to(`battle:${roomId}`).emit("battle:duel_rejected", payload);
      for (const p of battle.players) {
        io.to(`user:${String(p.userId)}`).emit("battle:duel_rejected", payload);
      }
    } catch (err) {
      console.error("[battle:duel_reject]", err);
    }
  });

  // ─────────────────────────────────────────────────────────
  // battle:score_update
  // ─────────────────────────────────────────────────────────
  socket.on("battle:score_update", async ({ roomId, score }) => {
    try {
      await Battle.updateOne(
        { roomId, "players.userId": userId },
        { $set: { "players.$.score": score } }
      );
      io.to(`battle:${roomId}`).emit("battle:scores", { userId, score });
    } catch (err) {
      console.error("[battle:score_update]", err);
    }
  });

  // ─────────────────────────────────────────────────────────
  // battle:finish
  // ─────────────────────────────────────────────────────────
  socket.on("battle:finish", async ({ roomId, finalScores }, ack) => {
    try {
      const battle = await Battle.findOne({ roomId });
      if (!battle) return ack?.({ ok: false, error: "Sala no encontrada" });
      if (battle.estado !== "active") return ack?.({ ok: true, alreadyFinished: true });

      if (Array.isArray(finalScores)) {
        finalScores.forEach(({ userId: uid, score }) => {
          const p = battle.players.find(p => String(p.userId) === String(uid));
          if (p) p.score = score;
        });
      }

      const sorted    = [...battle.players].sort((a, b) => b.score - a.score);
      const topScore  = sorted[0]?.score ?? 0;
      const tiedGroup = sorted.filter(p => p.score === topScore);
      const ganadorId = tiedGroup.length === 1 ? String(sorted[0].userId) : null;

      battle.estado     = "finished";
      battle.finishedAt = new Date();
      battle.ganadorId  = ganadorId;
      await battle.save();

      const allIds = battle.players.map(p => String(p.userId));
      if (ganadorId) {
        await updateUserStats({ tipo: "win", winnerId: ganadorId, playerIds: allIds });
      } else if (tiedGroup.length === allIds.length) {
        await updateUserStats({ tipo: "pact", playerIds: allIds });
      } else {
        const tiedIds = tiedGroup.map(p => String(p.userId));
        const restIds = sorted.filter(p => p.score < topScore).map(p => String(p.userId));
        await updateUserStats({ tipo: "multi_tie", tiedIds, restIds });
      }

      io.to(`battle:${roomId}`).emit("battle:ended", {
        ganadorId,
        players: battle.players.map(p => ({
          userId:    String(p.userId),
          username:  p.username,
          avatarUrl: p.avatarUrl ?? null,
          status:    p.status,
          score:     p.score ?? 0,
        })),
      });

      gameRooms.delete(roomId);
      ack?.({ ok: true, ganadorId });
    } catch (err) {
      console.error("[battle:finish]", err);
      ack?.({ ok: false, error: "Error interno" });
    }
  });

  // ─────────────────────────────────────────────────────────
  // battle:leave
  // ─────────────────────────────────────────────────────────
  socket.on("battle:leave", async ({ roomId }) => {
    try {
      socket.leave(`battle:${roomId}`);
      socket.to(`battle:${roomId}`).emit("battle:player_left", { userId, username });

      const battle = await Battle.findOne({ roomId });
      if (battle && battle.estado === "active") {
        const player = battle.players.find(p => String(p.userId) === userId);
        if (player) {
          player.status = "declined";
          await battle.save();
          io.to(`battle:${battle.roomId}`).emit("battle:state_update", buildStatePayload(battle));
        }
      }
    } catch (err) {
      console.error("[battle:leave]", err);
    }
  });

  // ─────────────────────────────────────────────────────────
  // disconnect
  // ─────────────────────────────────────────────────────────
  socket.on("disconnect", async () => {
    try {
      const activeBattles = await Battle.find({
        "players.userId": userId,
        estado: { $in: ["waiting", "active"] },
      });

      for (const battle of activeBattles) {
        socket.to(`battle:${battle.roomId}`).emit("battle:player_left", { userId, username });

        if (battle.estado === "active") {
          const player = battle.players.find(p => String(p.userId) === userId);
          if (player) {
            player.status = "declined";
            await battle.save();
            io.to(`battle:${battle.roomId}`).emit("battle:state_update", buildStatePayload(battle));
          }
        }
      }
    } catch (err) {
      console.error("[socketBattle disconnect]", err);
    }
  });
};