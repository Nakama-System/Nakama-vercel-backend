// ═══════════════════════════════════════════════════════════
// controllers/nx-control/blocksController.js — Nakama
// Superadmin: gestión de bloqueos entre usuarios
// ═══════════════════════════════════════════════════════════

const { Block } = require("../models/BlockReport");
const User      = require("../models/User");

// ═══════════════════════════════════════════════════════════
// GET /nx-control/blocks
// Query: page, limit, search (username del blocker o blocked)
// ═══════════════════════════════════════════════════════════
exports.listBlocks = async (req, res) => {
  try {
    const page  = Math.max(1, parseInt(req.query.page)  || 1);
    const limit = Math.min(50, parseInt(req.query.limit) || 20);
    const skip  = (page - 1) * limit;

    let blockQuery = {};

    // Si hay búsqueda, primero resolvemos los IDs de usuarios que coincidan
    if (req.query.search) {
      const rx = new RegExp(req.query.search.trim(), "i");
      const matchingUsers = await User.find({ username: rx })
        .select("_id")
        .limit(50)
        .lean();
      const ids = matchingUsers.map((u) => u._id);
      if (ids.length) {
        blockQuery.$or = [{ blocker: { $in: ids } }, { blocked: { $in: ids } }];
      } else {
        // Búsqueda sin resultados → devolver vacío
        return res.json({
          ok: true,
          data: [],
          pagination: { page, limit, total: 0, pages: 0 },
        });
      }
    }

    const [data, total] = await Promise.all([
      Block.find(blockQuery)
        .populate("blocker", "username avatarUrl isOnline isBanned isSuspended")
        .populate("blocked", "username avatarUrl isOnline isBanned isSuspended")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Block.countDocuments(blockQuery),
    ]);

    return res.json({
      ok: true,
      data,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (err) {
    console.error("[SA blocks list]", err);
    return res.status(500).json({ ok: false, message: err.message });
  }
};

// ═══════════════════════════════════════════════════════════
// GET /nx-control/blocks/:id
// ═══════════════════════════════════════════════════════════
exports.getBlock = async (req, res) => {
  try {
    const block = await Block.findById(req.params.id)
      .populate("blocker", "username email avatarUrl isOnline isBanned isSuspended role")
      .populate("blocked", "username email avatarUrl isOnline isBanned isSuspended role")
      .lean();

    if (!block) return res.status(404).json({ ok: false, message: "Bloqueo no encontrado" });

    return res.json({ ok: true, data: block });
  } catch (err) {
    return res.status(500).json({ ok: false, message: err.message });
  }
};

// ═══════════════════════════════════════════════════════════
// DELETE /nx-control/blocks/:id
// Superadmin elimina un bloqueo (ej: falso positivo o abuso)
// También lo remueve del array blockedUsers del User
// ═══════════════════════════════════════════════════════════
exports.deleteBlock = async (req, res) => {
  try {
    const block = await Block.findById(req.params.id);
    if (!block) return res.status(404).json({ ok: false, message: "Bloqueo no encontrado" });

    // Quitar del array blockedUsers en el documento del blocker
    await User.updateOne(
      { _id: block.blocker },
      { $pull: { blockedUsers: block.blocked } },
    );

    await block.deleteOne();

    return res.json({ ok: true, message: "Bloqueo eliminado" });
  } catch (err) {
    return res.status(500).json({ ok: false, message: err.message });
  }
};

// ═══════════════════════════════════════════════════════════
// POST /nx-control/blocks/force
// Superadmin fuerza un bloqueo entre dos usuarios
// body: { blockerId, blockedId, reason? }
// Útil para: separar usuarios con historial de acoso
// ═══════════════════════════════════════════════════════════
exports.forceBlock = async (req, res) => {
  try {
    const { blockerId, blockedId, reason } = req.body;
    if (!blockerId || !blockedId)
      return res.status(400).json({ ok: false, message: "blockerId y blockedId requeridos" });
    if (String(blockerId) === String(blockedId))
      return res.status(400).json({ ok: false, message: "No podés bloquear al mismo usuario" });

    // Verificar que ambos usuarios existen
    const [blocker, blocked] = await Promise.all([
      User.findById(blockerId).select("_id username"),
      User.findById(blockedId).select("_id username"),
    ]);
    if (!blocker) return res.status(404).json({ ok: false, message: "Blocker no encontrado" });
    if (!blocked) return res.status(404).json({ ok: false, message: "Blocked no encontrado" });

    // Crear bloqueo (si ya existe, findOneAndUpdate lo ignora)
    await Block.findOneAndUpdate(
      { blocker: blockerId, blocked: blockedId },
      { blocker: blockerId, blocked: blockedId },
      { upsert: true, new: true },
    );

    // Sincronizar array en User
    await User.updateOne(
      { _id: blockerId },
      { $addToSet: { blockedUsers: blockedId } },
    );

    return res.json({
      ok: true,
      message: `Bloqueo forzado: @${blocker.username} → @${blocked.username}`,
      reason: reason || null,
    });
  } catch (err) {
    // Duplicate key = ya existía, no es error grave
    if (err.code === 11000)
      return res.json({ ok: true, message: "El bloqueo ya existía" });
    return res.status(500).json({ ok: false, message: err.message });
  }
};

// ═══════════════════════════════════════════════════════════
// GET /nx-control/blocks/check
// Verifica si dos usuarios se bloquean mutuamente
// Query: userA, userB
// ═══════════════════════════════════════════════════════════
exports.checkBlock = async (req, res) => {
  try {
    const { userA, userB } = req.query;
    if (!userA || !userB)
      return res.status(400).json({ ok: false, message: "userA y userB requeridos" });

    const [aBlocksB, bBlocksA] = await Promise.all([
      Block.exists({ blocker: userA, blocked: userB }),
      Block.exists({ blocker: userB, blocked: userA }),
    ]);

    return res.json({
      ok:     true,
      aBlocksB: !!aBlocksB,
      bBlocksA: !!bBlocksA,
      mutual:   !!aBlocksB && !!bBlocksA,
    });
  } catch (err) {
    return res.status(500).json({ ok: false, message: err.message });
  }
};