const express = require("express");
const router  = express.Router();
const ctrl    = require("../controllers/usersController");

// ─────────────────────────────────────────────────────────
// NOTIFICACIONES MASIVAS
// Deben ir ANTES de /:id para que Express no interprete
// "notify-batch", "notify-role" o "notify-all" como un :id
// ─────────────────────────────────────────────────────────

// POST /nx-control/users/notify-batch  → { userIds, message, title? }
router.post("/notify-batch", ctrl.notifyBatch);
// POST /nx-control/users/notify-role   → { role, message, title? }
router.post("/notify-role",  ctrl.notifyRole);
// POST /nx-control/users/notify-all    → { message, title? }
router.post("/notify-all",   ctrl.notifyAll);

// ─────────────────────────────────────────────────────────
// CRUD / ACCIONES INDIVIDUALES
// ─────────────────────────────────────────────────────────

// GET    /nx-control/users
router.get("/",                ctrl.listUsers);
// GET    /nx-control/users/:id
router.get("/:id",             ctrl.getUser);
// POST   /nx-control/users/:id/ban
router.post("/:id/ban",        ctrl.banUser);
// POST   /nx-control/users/:id/unban
router.post("/:id/unban",      ctrl.unbanUser);
// POST   /nx-control/users/:id/freeze
router.post("/:id/freeze",     ctrl.freezeUser);
// POST   /nx-control/users/:id/unfreeze
router.post("/:id/unfreeze",   ctrl.unfreezeUser);
// POST   /nx-control/users/:id/warn
router.post("/:id/warn",       ctrl.warnUser);
// PATCH  /nx-control/users/:id/role
router.patch("/:id/role",      ctrl.changeRole);
// POST   /nx-control/users/:id/notify
router.post("/:id/notify",     ctrl.notifyUser);
// DELETE /nx-control/users/:id
router.delete("/:id",          ctrl.deleteUser);
// GET    /nx-control/users/:id/blocks
router.get("/:id/blocks",      ctrl.getUserBlocks);

module.exports = router;