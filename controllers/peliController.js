// backend/controllers/moviesController.js
const Movie = require("../models/Movie");
const FRONTEND_URL = process.env.FRONTEND_URL || "https://nakama-vercel-backend.vercel.app";

const PAGE_SIZE    = 9;

function serialize(m, userId = null) {
  const o = m.toObject ? m.toObject() : m;
  return {
    id:          o._id,
    title:       o.title,
    description: o.description,
    thumbnail:   o.thumbnail,
    videoUrl:    o.videoUrl,
    year:        o.year,
    duration:    o.duration,
    category:    o.category,
    ageRating:   o.ageRating ?? "all",   // ← nuevo campo
    canDownload: o.canDownload,
    isPublished: o.isPublished,
    rating:      o.rating,
    votesCount:  o.votesCount,
    views:       o.views,
    slug:        o.slug,
    publicUrl:   o.publicUrl,
    userVoted:   userId ? m.hasVoted?.(userId) ?? false : false,
    createdAt:   o.createdAt,
  };
}

function isAdmin(req) {
  return req.user?.role === "superadmin" || req.user?.role === "admin";
}

/* GET /moviesup ─────────────────────────────────────────── */
exports.getMovies = async (req, res) => {
  try {
    const {
      category  = "",
      ageRating = "",
      search    = "",
      page      = 1,
      limit     = PAGE_SIZE,
      sort      = "newest",
    } = req.query;

    const pg  = Math.max(1, +page  || 1);
    const lim = Math.min(50, +limit || PAGE_SIZE);

    const filter = isAdmin(req) ? {} : { isPublished: true };

    if (category  && category  !== "all") filter.category  = category;
    if (ageRating && ageRating !== "all") filter.ageRating = ageRating;

    if (search.trim()) {
      filter.$or = [
        { title:       { $regex: search.trim(), $options: "i" } },
        { description: { $regex: search.trim(), $options: "i" } },
      ];
    }

    const sortMap = {
      newest:  { createdAt: -1 },
      popular: { views: -1 },
      rating:  { rating: -1 },
    };

    const [items, total] = await Promise.all([
      Movie.find(filter)
        .sort(sortMap[sort] || sortMap.newest)
        .skip((pg - 1) * lim)
        .limit(lim)
        .select("-votes"),
      Movie.countDocuments(filter),
    ]);

    res.json({
      items:      items.map(m => serialize(m, req.user?._id)),
      total,
      page:       pg,
      totalPages: Math.ceil(total / lim),
      limit:      lim,
    });
  } catch (e) {
    console.error("[getMovies]", e);
    res.status(500).json({ error: "Error al obtener películas" });
  }
};

/* GET /moviesup/:id ─────────────────────────────────────── */
exports.getMovieById = async (req, res) => {
  try {
    const isId   = /^[a-f\d]{24}$/i.test(req.params.id);
    const filter = isAdmin(req) ? {} : { isPublished: true };

    const movie = await Movie.findOne({
      $or: [
        ...(isId ? [{ _id: req.params.id }] : []),
        { slug: req.params.id },
      ],
      ...filter,
    });

    if (!movie) return res.status(404).json({ error: "No encontrada" });

    await Movie.findByIdAndUpdate(movie._id, { $inc: { views: 1 } });

    res.json(serialize(movie, req.user?._id));
  } catch (e) {
    console.error("[getMovieById]", e);
    res.status(500).json({ error: "Error al obtener película" });
  }
};

/* GET /moviesup/:id/share ───────────────────────────────── */
/* GET /moviesup/:id/share ───────────────────────────────── */
exports.getShareMeta = async (req, res) => {
  try {
    const m = await Movie.findById(req.params.id)
      .select("title description thumbnail slug _id").lean({ virtuals: true });
    if (!m) return res.status(404).json({ error: "No encontrada" });

    const sharePageUrl = `https://nakama-vercel-backend.vercel.app/share-movie?id=${m._id}`;
    const title        = m.title || "Nakama Universe";
    const text         = encodeURIComponent(`🎬 ${title}\n${(m.description || "").slice(0, 100)}…`);
    const enc          = encodeURIComponent(sharePageUrl);

    res.json({
      url:         sharePageUrl,
      title,
      description: m.description,
      image:       m.thumbnail,
      og: {
        "og:title":       title,
        "og:description": m.description,
        "og:image":       m.thumbnail,
        "og:url":         sharePageUrl,
        "og:type":        "video.movie",
      },
      facebook: `https://www.facebook.com/sharer/sharer.php?u=${enc}`,
      whatsapp: `https://api.whatsapp.com/send?text=${text}%20${enc}`,
      twitter:  `https://twitter.com/intent/tweet?text=${text}&url=${enc}`,
      telegram: `https://t.me/share/url?url=${enc}&text=${text}`,
    });
  } catch (e) {
    res.status(500).json({ error: "Error al generar metadatos" });
  }
};

/* POST /moviesup/:id/vote ───────────────────────────────── */
exports.voteMovie = async (req, res) => {
  try {
    const r = parseInt(req.body.rating, 10);
    if (!r || r < 1 || r > 5) return res.status(400).json({ error: "Rating inválido (1-5)" });

    const movie = await Movie.findById(req.params.id);
    if (!movie) return res.status(404).json({ error: "No encontrada" });

    if (movie.hasVoted(req.user?._id)) return res.status(409).json({ error: "Ya votaste" });
    await movie.addVote(req.user?._id, r);
    res.json({ ok: true, newRating: movie.rating, votesCount: movie.votesCount });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

/* POST /moviesup/:id/download ──────────────────────────── */
exports.downloadMovie = async (req, res) => {
  try {
    const movie = await Movie.findById(req.params.id).select("canDownload videoUrl title");
    if (!movie) return res.status(404).json({ error: "No encontrada" });
    if (!movie.canDownload) return res.status(403).json({ ok: false, error: "Descarga no permitida" });
    res.json({ ok: true, downloadUrl: movie.videoUrl, filename: `${movie.title}.mp4` });
  } catch (e) {
    res.status(500).json({ error: "Error al procesar descarga" });
  }
};

/* CRUD ─────────────────────────────────────────────────── */
exports.createMovie = async (req, res) => {
  try {
    const m = new Movie(req.body);
    if (!m.slug && m.title) {
      m.slug = m.title
        .toLowerCase()
        .replace(/\s+/g, "-")
        .replace(/[^a-z0-9-]/g, "")
        .slice(0, 80);
    }
    await m.save();
    res.status(201).json(serialize(m));
  } catch (e) {
    res.status(e.code === 11000 ? 409 : 400).json({ error: e.message });
  }
};

exports.updateMovie = async (req, res) => {
  try {
    const m = await Movie.findByIdAndUpdate(
      req.params.id, req.body, { new: true, runValidators: true },
    );
    if (!m) return res.status(404).json({ error: "No encontrada" });
    res.json(serialize(m));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
};

exports.deleteMovie = async (req, res) => {
  try {
    const m = await Movie.findByIdAndDelete(req.params.id);
    if (!m) return res.status(404).json({ error: "No encontrada" });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: "Error al eliminar" });
  }
};
