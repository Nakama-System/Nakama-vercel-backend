// ═══════════════════════════════════════════════════════════
// routes/nx-control/communityRoutes.js — Superadmin
// ═══════════════════════════════════════════════════════════

const express   = require("express");
const router    = express.Router();
const Community = require("../models/Community");

// ── GET /nx-control/communities ──────────────────────────
// Query params: page, limit, search
router.get("/", async (req, res) => {
  try {
    const page   = Math.max(1, parseInt(req.query.page)  || 1);
    const limit  = Math.min(50, parseInt(req.query.limit) || 20);
    const skip   = (page - 1) * limit;
    const search = req.query.search?.trim();

    const filter = search
      ? { name: { $regex: search, $options: "i" } }
      : {};

    const [data, total] = await Promise.all([
      Community.find(filter)
        .sort({ memberCount: -1, createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .select("name description memberCount likeCount theme messagingOpen createdAt creatorId")
        .lean(),
      Community.countDocuments(filter),
    ]);

    return res.json({
      ok: true,
      data,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (err) {
    return res.status(500).json({ ok: false, message: err.message });
  }
});

// ── POST /nx-control/communities/:id/freeze ───────────────
// body: { freeze: true/false }  — congela o abre el chat
router.post("/:id/freeze", async (req, res) => {
  try {
    const { freeze } = req.body;
    const community = await Community.findByIdAndUpdate(
      req.params.id,
      { messagingOpen: !freeze },
      { new: true }
    ).select("name messagingOpen");

    if (!community)
      return res.status(404).json({ ok: false, message: "Comunidad no encontrada" });

    return res.json({ ok: true, data: community });
  } catch (err) {
    return res.status(500).json({ ok: false, message: err.message });
  }
});

// ── DELETE /nx-control/communities/:id ───────────────────
router.delete("/:id", async (req, res) => {
  try {
    const community = await Community.findByIdAndDelete(req.params.id);
    if (!community)
      return res.status(404).json({ ok: false, message: "Comunidad no encontrada" });

    return res.json({ ok: true, message: "Comunidad eliminada" });
  } catch (err) {
    return res.status(500).json({ ok: false, message: err.message });
  }
});

module.exports = router;