// ═══════════════════════════════════════════════════════════
// controllers/uploadController.js — Nakama | Chat uploads
// Sube imágenes, videos, audios y películas a Cloudinary
// ═══════════════════════════════════════════════════════════

const {
  uploadToCloudinary,
  uploadLargeVideo,
  trimVideoAndUpload,
} = require("../services/cloudinaryService");
const ChatUpload = require("../models/ChatUpload");

function detectFileType(mimetype) {
  const m = mimetype.toLowerCase();
  if (m === "image/gif")        return "gif";
  if (m.startsWith("image/"))   return "image";
  if (m.startsWith("video/"))   return "video";
  if (m.startsWith("audio/"))   return "audio";
  return "file";
}

// ═══════════════════════════════════════════════════════════
// POST /uploads/chat-file
// Soporta: ?type=ephemeral o form-data field type=ephemeral
// Soporta: videos pequeños (clips) y películas grandes (>50 MB)
// ═══════════════════════════════════════════════════════════
exports.uploadChatFile = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: "No se recibió ningún archivo." });
    }

    const buffer   = req.file.buffer;
    const mime     = req.file.mimetype;
    const fileType = detectFileType(mime);
    const duration = parseInt(req.body.duration, 10) || 0;
    const userId   = req.user._id || req.user.id;

    // Detectar si es para ephemeral
    const isEphemeral = req.query.type === "ephemeral" || req.body.type === "ephemeral";
    const folder      = isEphemeral ? "nakama/ephemeral" : "nakama/chat/images";

    console.log(`[uploadChatFile] isEphemeral: ${isEphemeral}, folder: ${folder}, type: ${fileType}, size: ${(buffer.length / 1024 / 1024).toFixed(1)} MB`);

    let result = {};

    // ── IMAGE / GIF ───────────────────────────────────────
    if (fileType === "image" || fileType === "gif") {
      const cloudRes = await uploadToCloudinary(buffer, {
        resource_type: "image",
        folder,
        transformation: fileType === "gif"
          ? []
          : [{ quality: "auto:good", fetch_format: "auto" }],
      });

      result = {
        url:          cloudRes.secure_url,
        thumbnailUrl: cloudRes.secure_url,
        type:         fileType,
        width:        cloudRes.width,
        height:       cloudRes.height,
        size:         cloudRes.bytes,
        mimeType:     mime,
        publicId:     cloudRes.public_id,
      };
    }

    // ── VIDEO ─────────────────────────────────────────────
    else if (fileType === "video") {
      const isLargeFile = buffer.length > 50 * 1024 * 1024; // >50 MB = película

      if (isLargeFile) {
        // ── Película completa — upload chunked sin recorte ──
        console.log(`[uploadChatFile] Película grande detectada (${(buffer.length / 1024 / 1024).toFixed(1)} MB), usando upload chunked`);

        const cloudRes = await uploadLargeVideo(buffer, {
          folder: `${folder}/movies`,
        });

        // Thumbnail automático del primer frame
        const thumbnailUrl = cloudRes.secure_url.replace(
          "/upload/",
          "/upload/so_0,w_640,h_360,c_fill/f_jpg/"
        );

        result = {
          url:          cloudRes.secure_url,
          thumbnailUrl,
          type:         "video",
          mimeType:     mime,
          size:         cloudRes.bytes,
          publicId:     cloudRes.public_id,
        };
      } else {
        // ── Clip corto — flujo original con trim ──
        const cloudRes = await trimVideoAndUpload(buffer, {
          folder,
          trimStart: 0,
          trimEnd:   60,
        });

        result = {
          url:          cloudRes.fullUrl,
          thumbnailUrl: cloudRes.thumbnailUrl,
          clippedUrl:   cloudRes.clippedUrl,
          type:         "video",
          mimeType:     mime,
          publicId:     cloudRes.fullPublicId,
        };
      }
    }

    // ── AUDIO ─────────────────────────────────────────────
    else if (fileType === "audio") {
      const cloudRes = await uploadToCloudinary(buffer, {
        resource_type: "video", // Cloudinary usa "video" para audio también
        folder,
        format: mime.includes("webm") ? "webm" : "mp3",
      });

      result = {
        url:      cloudRes.secure_url,
        type:     "audio",
        duration: duration || Math.round(cloudRes.duration || 0),
        mimeType: mime,
        size:     cloudRes.bytes,
        publicId: cloudRes.public_id,
      };
    }

    else {
      return res.status(400).json({ message: "Tipo de archivo no soportado en chat." });
    }

    // Solo guardar en ChatUpload si NO es ephemeral
    if (!isEphemeral) {
      const doc = await ChatUpload.create({ userId, ...result });
      return res.status(200).json({ ...result, _id: doc._id });
    }

    // Ephemeral: devolver solo la URL sin guardar en DB
    return res.status(200).json({ ...result, _id: null });

  } catch (err) {
    console.error("[uploadController:uploadChatFile] Error:", err.message);
    return res.status(500).json({ message: err.message || "Error al subir el archivo." });
  }
};