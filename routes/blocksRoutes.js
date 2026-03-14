// ═══════════════════════════════════════════════════════════
// routes/nx-control/blocks.js — Nakama Superadmin
// ═══════════════════════════════════════════════════════════

const express = require("express");
const router  = express.Router();
const ctrl    = require("../controllers/blocksController");

// GET    /nx-control/blocks              → listar todos con paginación
// GET    /nx-control/blocks/check        → verificar bloqueo entre dos usuarios
// GET    /nx-control/blocks/:id          → detalle de un bloqueo
// POST   /nx-control/blocks/force        → forzar bloqueo entre dos usuarios
// DELETE /nx-control/blocks/:id          → eliminar un bloqueo

// IMPORTANTE: /check y /force ANTES de /:id para que Express no los confunda
router.get   ("/check",  ctrl.checkBlock);
router.post  ("/force",  ctrl.forceBlock);

router.get   ("/",       ctrl.listBlocks);
router.get   ("/:id",    ctrl.getBlock);
router.delete("/:id",    ctrl.deleteBlock);

module.exports = router;