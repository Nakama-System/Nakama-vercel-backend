// ═══════════════════════════════════════════════════════════
// config/db.js — Nakama | Conexión a MongoDB
//
// Uso en index.js:
//   const connectDB = require("./config/db");
//   connectDB();
// ═══════════════════════════════════════════════════════════

const mongoose = require("mongoose");
require("dotenv").config();

const MONGO_URI = process.env.MONGO_URI;

// ─── Opciones de conexión ─────────────────────────────────
const MONGO_OPTIONS = {
  

  serverSelectionTimeoutMS: 8000,

  socketTimeoutMS: 45000,

  // Reconexión automática
  autoIndex: true,  // En producción podés ponerlo en false y crear índices manualmente
};

// ─── Función principal ────────────────────────────────────
async function connectDB() {
  const uri = MONGO_URI;
  if (!uri) {
    console.error("❌  MONGO_URI no está definida en el archivo .env");
    process.exit(1);
  }

  try {
    const conn = await mongoose.connect(uri, MONGO_OPTIONS);

    console.log("✅  MongoDB conectado");
    console.log(`    Host : ${conn.connection.host}`);
    console.log(`    DB   : ${conn.connection.name}`);

    // ─── Eventos de conexión ──────────────────────────────
    mongoose.connection.on("disconnected", () => {
      console.warn("⚠️   MongoDB desconectado. Intentando reconectar...");
    });

    mongoose.connection.on("reconnected", () => {
      console.log("🔄  MongoDB reconectado.");
    });

    mongoose.connection.on("error", (err) => {
      console.error("❌  Error en la conexión MongoDB:", err.message);
    });

    // Cierre limpio al apagar el servidor
    process.on("SIGINT", async () => {
      await mongoose.connection.close();
      console.log("🛑  MongoDB cerrado. Servidor detenido.");
      process.exit(0);
    });

    return conn;
  } catch (err) {
    console.error("❌  No se pudo conectar a MongoDB:", err.message);
    console.error("    Verificá que MONGO_URI en tu .env sea correcta.");
    process.exit(1);
  }
}

module.exports = connectDB;