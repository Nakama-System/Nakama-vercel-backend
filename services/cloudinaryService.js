// ═══════════════════════════════════════════════════════════
// services/cloudinaryService.js — Nakama | Cloudinary
// ═══════════════════════════════════════════════════════════
const cloudinary = require("cloudinary").v2;
const streamifier = require("streamifier");

// ─── Configurar Cloudinary ────────────────────────────────

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});


// ─── Límite de videos almacenados por usuario ─────────────
const MAX_STORED_VIDEOS = 30;

// ═══════════════════════════════════════════════════════════
// uploadStream — buffer pequeño (imágenes, GIFs, audios, clips)
// ═══════════════════════════════════════════════════════════
function uploadStream(buffer, options = {}) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(options, (error, result) => {
      if (error) return reject(error);
      resolve(result);
    });
    streamifier.createReadStream(buffer).pipe(stream);
  });
}

// ═══════════════════════════════════════════════════════════
// uploadLargeVideo — películas y videos grandes (>50 MB)
// Usa upload_chunked_stream de Cloudinary (soporta hasta 5 GB)
// ═══════════════════════════════════════════════════════════
function uploadLargeVideo(buffer, options = {}) {
  return new Promise((resolve, reject) => {
    const CHUNK_SIZE = 100 * 1024 * 1024; // 100 MB por chunk

    const stream = cloudinary.uploader.upload_chunked_stream(
      {
        resource_type: "video",
        chunk_size:    CHUNK_SIZE,
        ...options,
      },
      (error, result) => {
        if (error) return reject(error);
        resolve(result);
      }
    );

    streamifier.createReadStream(buffer).pipe(stream);
  });
}

// ═══════════════════════════════════════════════════════════
// uploadToCloudinary — imágenes, GIFs, audios
// (sin cambios — funciona igual que antes)
// ═══════════════════════════════════════════════════════════
async function uploadToCloudinary(buffer, opts = {}) {
  const options = {
    resource_type: "image",
    folder:        "nakama/avatars",
    ...opts,
  };

  // Si por alguna razón se pasa un video grande aquí, redirigir automáticamente
  if (
    options.resource_type === "video" &&
    buffer.length > 50 * 1024 * 1024
  ) {
    return uploadLargeVideo(buffer, options);
  }

  const result = await uploadStream(buffer, options);
  return result;
}

// ═══════════════════════════════════════════════════════════
// trimVideoAndUpload — sube video completo + genera clip/thumbnail
// Usado para videos de perfil (clips cortos)
// (sin cambios de interfaz — compatible con todo el código existente)
// ═══════════════════════════════════════════════════════════
async function trimVideoAndUpload(buffer, opts = {}) {
  const { folder = "nakama/profile_videos", trimStart = 0, trimEnd = 6 } = opts;

  // Para archivos >50 MB usar chunked, para clips pequeños usar stream normal
  const isLargeFile = buffer.length > 50 * 1024 * 1024;
  const uploadFn    = isLargeFile ? uploadLargeVideo : uploadStream;

  // 1. Subir video original
  const fullResult = await uploadFn(buffer, {
    resource_type: "video",
    folder:        `${folder}/full`,
  });

  const fullPublicId = fullResult.public_id;
  const fullUrl      = fullResult.secure_url;

  // 2. URL del clip recortado (generada dinámicamente por Cloudinary, no sube archivo extra)
  const clippedUrl = cloudinary.url(fullPublicId, {
    resource_type:  "video",
    transformation: [
      { start_offset: trimStart, end_offset: trimEnd },
      { width: 480, height: 480, crop: "fill", gravity: "face" },
    ],
    format: "mp4",
  });

  // 3. Thumbnail del video
  const thumbnailUrl = cloudinary.url(fullPublicId, {
    resource_type:  "video",
    transformation: [
      { start_offset: "0" },
      { width: 400, height: 400, crop: "fill", gravity: "face" },
    ],
    format: "jpg",
  });

  return {
    fullUrl,
    fullPublicId,
    clippedUrl,
    thumbnailUrl,
  };
}

// ═══════════════════════════════════════════════════════════
// deleteFromCloudinary — eliminar recurso
// ═══════════════════════════════════════════════════════════
async function deleteFromCloudinary(publicId, resourceType = "image") {
  return cloudinary.uploader.destroy(publicId, { resource_type: resourceType });
}

// ═══════════════════════════════════════════════════════════
// checkStorageWarning — aviso cuando llega a 30 videos
// ═══════════════════════════════════════════════════════════
function checkStorageWarning(storedCount) {
  if (storedCount >= MAX_STORED_VIDEOS) {
    return {
      shouldWarn: true,
      message: `Llegaste al límite de ${MAX_STORED_VIDEOS} videos almacenados. Por favor, eliminá algunos para poder subir nuevos.`,
    };
  }
  if (storedCount >= MAX_STORED_VIDEOS - 5) {
    return {
      shouldWarn: true,
      message: `Tenés ${MAX_STORED_VIDEOS - storedCount} videos restantes antes de alcanzar el límite de almacenamiento.`,
    };
  }
  return { shouldWarn: false, message: "" };
}

module.exports = {
  uploadToCloudinary,
  uploadLargeVideo,
  trimVideoAndUpload,
  deleteFromCloudinary,
  checkStorageWarning,
  MAX_STORED_VIDEOS,
};