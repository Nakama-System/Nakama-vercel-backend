// ═══════════════════════════════════════════════════════════
// authcontroller/getComunidadController.js
// ═══════════════════════════════════════════════════════════

const Community = require("../models/Community");

// ── helpers ───────────────────────────────────────────────

/** Campos públicos que siempre se exponen */
const PUBLIC_FIELDS =
  "name description avatarUrl coverUrl memberCount likeCount theme rules createdAt";

/**
 * Enriquece un comunidad plain-object con datos del usuario
 * que hace la request (si está autenticado).
 */
function withMembership(doc, userId) {
  const obj = doc.toObject ? doc.toObject() : { ...doc };

  // Eliminar datos sensibles
  delete obj.bannedUsers;
  delete obj.unreadCounts;

  if (!userId) {
    obj.isMember = false;
    obj.isAdmin  = false;
    return obj;
  }

  const uid    = userId.toString();
  const member = (obj.members || []).find(
    (m) => m.userId && m.userId.toString() === uid,
  );

  obj.isMember = !!member;
  obj.isAdmin  = member?.role === "admin";

  // No exponer lista de members al público
  delete obj.members;

  return obj;
}

// ── GET /comunidades ──────────────────────────────────────
/**
 * Lista pública de comunidades.
 * Query params:
 *   - page   (default 1)
 *   - limit  (default 20, max 50)
 *   - search (texto libre sobre name)
 *   - sort   (newest | popular | members) default newest
 */
exports.getComunidades = async (req, res) => {
  try {
    const page   = Math.max(1, parseInt(req.query.page)  || 1);
    const limit  = Math.min(50, Math.max(1, parseInt(req.query.limit) || 20));
    const search = (req.query.search || "").trim();
    const sort   = req.query.sort || "newest";

    // ── filtro ────────────────────────────────────────────
    const filter = {};
    if (search) {
      filter.$or = [
        { name:        { $regex: search, $options: "i" } },
        { description: { $regex: search, $options: "i" } },
      ];
    }

    // ── orden ─────────────────────────────────────────────
    const sortMap = {
      newest:  { createdAt:   -1 },
      popular: { likeCount:   -1 },
      members: { memberCount: -1 },
    };
    const sortObj = sortMap[sort] || sortMap.newest;

    // ── query ─────────────────────────────────────────────
    const [communities, total] = await Promise.all([
      Community.find(filter)
        .select(PUBLIC_FIELDS + " members")   // members solo para calcular isMember
        .sort(sortObj)
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(false),                          // necesitamos toObject()
      Community.countDocuments(filter),
    ]);

    const userId = req.user?.id || req.user?._id || null;

    const data = communities.map((c) => withMembership(c, userId));

    return res.json({
      ok: true,
      data,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    });
  } catch (err) {
    console.error("[getComunidades]", err);
    return res.status(500).json({ ok: false, message: "Error interno del servidor" });
  }
};

// ── GET /comunidades/:id ──────────────────────────────────
/**
 * Detalle público de una comunidad por _id o slug.
 * Si el usuario es miembro también devuelve sus datos de miembro.
 */
exports.getComunidadById = async (req, res) => {
  try {
    const { id } = req.params;

    // Soportar búsqueda por _id (ObjectId) o por slug
    const isObjectId = /^[a-f\d]{24}$/i.test(id);
    const filter     = isObjectId ? { _id: id } : { slug: id };

    const community = await Community.findOne(filter);

    if (!community) {
      return res.status(404).json({ ok: false, message: "Comunidad no encontrada" });
    }

    const userId = req.user?.id || req.user?._id || null;
    const data   = withMembership(community, userId);

    // Si es miembro, devolver sus datos de miembro completos
    if (data.isMember && userId) {
      const memberDoc = community.members.find(
        (m) => m.userId && m.userId.toString() === userId.toString(),
      );
      if (memberDoc) data.memberData = memberDoc;
    }

    return res.json({ ok: true, data });
  } catch (err) {
    console.error("[getComunidadById]", err);
    return res.status(500).json({ ok: false, message: "Error interno del servidor" });
  }
};