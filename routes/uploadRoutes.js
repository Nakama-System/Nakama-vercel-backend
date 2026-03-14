// ═══════════════════════════════════════════════════════════
// routes/uploadRoutes.js — Nakama | Chat file uploads
// ═══════════════════════════════════════════════════════════

const express  = require("express");
const router   = express.Router();
const multer   = require("multer");
const { protect } = require("../middlewares/authMiddleware");
const uploadController = require("../controllers/uploadController");

const storage = multer.memoryStorage();

const fileFilter = (req, file, cb) => {
  const allowed = [
    "image/jpeg", "image/jpg", "image/png", "image/gif", "image/webp",
    "video/mp4", "video/webm", "video/quicktime", "video/ogg",
    "audio/webm", "audio/ogg", "audio/mpeg", "audio/mp4",
    "audio/webm;codecs=opus",
  ];
  const mime = file.mimetype.toLowerCase();
  const ok   = allowed.some((a) => mime.startsWith(a.split(";")[0]));
  if (ok) cb(null, true);
  else    cb(new Error(`Tipo de archivo no soportado: ${file.mimetype}`), false);
};

// ─── Multer para archivos pequeños (imágenes, audios, clips cortos) ──
// Límite: 100 MB
const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 100 * 1024 * 1024 },
});

// ─── Multer para películas y videos grandes ───────────────────────
// Límite: 4 GB
const uploadMovie = multer({
  storage,
  fileFilter,
  limits: { fileSize: 4 * 1024 * 1024 * 1024 },
});

// ─────────────────────────────────────────────────────────────────
// POST /uploads/chat-file
// Videos pequeños (<100 MB): clips, mensajes de video
// ─────────────────────────────────────────────────────────────────
router.post(
  "/chat-file",
  protect,
  upload.single("file"),
  uploadController.uploadChatFile
);

// ─────────────────────────────────────────────────────────────────
// POST /uploads/movie-file
// Películas y videos grandes (hasta 4 GB)
// Usado por MovieUploadAdmin
// ─────────────────────────────────────────────────────────────────
router.post(
  "/movie-file",
  protect,
  uploadMovie.single("file"),
  uploadController.uploadChatFile  // mismo controller — detecta tamaño automáticamente
);

// ─────────────────────────────────────────────────────────────────
// POST /uploads/image
// Avatares, covers, fotos de perfil, portadas de películas
// ─────────────────────────────────────────────────────────────────
router.post(
  "/image",
  protect,
  upload.single("image"),
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ message: "No se recibió ningún archivo." });
      }

      const { uploadToCloudinary } = require("../services/cloudinaryService");

      const result = await uploadToCloudinary(req.file.buffer, {
        resource_type:  "image",
        folder:         "nakama/profile",
        transformation: [{ quality: "auto:good", fetch_format: "auto" }],
      });

      return res.status(200).json({ url: result.secure_url });
    } catch (err) {
      console.error("[upload/image]", err.message);
      return res.status(500).json({ message: err.message || "Error al subir imagen." });
    }
  }
);

module.exports = router;