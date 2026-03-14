// ═══════════════════════════════════════════════════════════
// routes/notificationRoutes.js — VERSIÓN FINAL COMPLETA
//
// Montar en Express:
//   app.use("/notifications", require("./routes/notificationRoutes"));
//
// RUTAS:
//   GET    /notifications           → listar todas del usuario
//   PATCH  /notifications/read-all  → marcar todas leídas
//   PATCH  /notifications/:id/read  → marcar una leída
//   DELETE /notifications           → borrar todas
//   DELETE /notifications/:id       → borrar una
// ═══════════════════════════════════════════════════════════
const express  = require("express");
const router   = express.Router();
const mongoose = require("mongoose");
const User     = require("../models/User");
const { protect } = require("../middlewares/authMiddleware");

router.use(protect);

// ─── Helper: string → ObjectId de forma segura ───────────
function toOid(str) {
  if (!str) return null;
  if (str instanceof mongoose.Types.ObjectId) return str;
  if (mongoose.Types.ObjectId.isValid(str)) return new mongoose.Types.ObjectId(str);
  return null;
}

// ═══════════════════════════════════════════════════════════
// GET /notifications
// Devuelve todas las notificaciones del usuario autenticado,
// ordenadas de más reciente a más antigua.
// Mapea: body (DB) → message (hook frontend)
//        _id (ObjectId) → id (string)
// ═══════════════════════════════════════════════════════════
router.get("/", async (req, res) => {
  try {
    const user = await User.findById(req.user._id)
      .select("notifications")
      .lean();

    if (!user)
      return res.status(404).json({ ok: false, message: "Usuario no encontrado" });

    const notifications = (user.notifications ?? [])
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .map((n) => ({
        id:             String(n._id),      // ← el hook usa `id`
        _id:            String(n._id),      // ← por si algo lo usa directo
        title:          n.title    || "Mensaje de Nakama",
        message:        n.body     || "",   // body en DB → message en el hook
        body:           n.body     || "",
        type:           n.type     || "admin",
        icon:           n.icon     || "🔔",
        link:           n.link     || "",
        chatId:         n.chatId ? String(n.chatId) : undefined,
        read:           Boolean(n.read),
        fromSystem:     Boolean(n.fromSystem),
        fromSuperAdmin: false,
        createdAt:      n.createdAt,
      }));

    return res.json({ ok: true, notifications });
  } catch (err) {
    console.error("[GET /notifications]", err);
    return res.status(500).json({ ok: false, message: err.message });
  }
});

// ═══════════════════════════════════════════════════════════
// PATCH /notifications/read-all
// DEBE ir ANTES de /:id para que Express no lo confunda
// ═══════════════════════════════════════════════════════════
router.patch("/read-all", async (req, res) => {
  try {
    await User.updateOne(
      { _id: req.user._id },
      { $set: { "notifications.$[].read": true } },
    );
    return res.json({ ok: true });
  } catch (err) {
    console.error("[PATCH /notifications/read-all]", err);
    return res.status(500).json({ ok: false, message: err.message });
  }
});

// ═══════════════════════════════════════════════════════════
// PATCH /notifications/:id/read
// ═══════════════════════════════════════════════════════════
router.patch("/:id/read", async (req, res) => {
  try {
    const oid = toOid(req.params.id);
    if (!oid)
      return res.status(400).json({ ok: false, message: "ID inválido" });

    await User.updateOne(
      { _id: req.user._id, "notifications._id": oid },
      { $set: { "notifications.$.read": true } },
    );
    return res.json({ ok: true });
  } catch (err) {
    console.error("[PATCH /notifications/:id/read]", err);
    return res.status(500).json({ ok: false, message: err.message });
  }
});

// ═══════════════════════════════════════════════════════════
// DELETE /notifications
// Borra TODAS las notificaciones del usuario
// ═══════════════════════════════════════════════════════════
router.delete("/", async (req, res) => {
  try {
    const result = await User.updateOne(
      { _id: req.user._id },
      { $set: { notifications: [] } },
    );
    console.log("[DELETE /notifications all] modifiedCount:", result.modifiedCount);
    return res.json({ ok: true });
  } catch (err) {
    console.error("[DELETE /notifications all]", err);
    return res.status(500).json({ ok: false, message: err.message });
  }
});

// ═══════════════════════════════════════════════════════════
// DELETE /notifications/:id
// Borra UNA notificación específica.
// FIX CLAVE: castear req.params.id a ObjectId antes del $pull.
// MongoDB no castea automáticamente strings a ObjectId en arrays.
// ═══════════════════════════════════════════════════════════
router.delete("/:id", async (req, res) => {
  try {
    const oid = toOid(req.params.id);

    if (!oid) {
      console.warn("[DELETE /notifications/:id] ID inválido:", req.params.id);
      return res.status(400).json({ ok: false, message: "ID de notificación inválido" });
    }

    console.log(`[DELETE /notifications/:id] user=${req.user._id} notifOid=${oid}`);

    const result = await User.updateOne(
      { _id: req.user._id },
      { $pull: { notifications: { _id: oid } } }, // ← ObjectId, no string
    );

    console.log(`[DELETE /notifications/:id] modifiedCount=${result.modifiedCount}`);

    if (result.modifiedCount === 0) {
      // No encontró la notif — puede que ya fue borrada o el id no corresponde
      return res.status(404).json({
        ok: false,
        message: "Notificación no encontrada o ya eliminada",
      });
    }

    return res.json({ ok: true });
  } catch (err) {
    console.error("[DELETE /notifications/:id] error:", err);
    return res.status(500).json({ ok: false, message: err.message });
  }
});

module.exports = router;