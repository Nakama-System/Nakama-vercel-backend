// ═══════════════════════════════════════════════════════════
// index.js — Nakama Backend
// CAMBIOS: SIN socket / SIN httpServer (apto Vercel o backend sin Socket.IO)
// ═══════════════════════════════════════════════════════════

require("dotenv").config();

const express      = require("express");
const cors         = require("cors");
const cookieParser = require("cookie-parser");
const session      = require("express-session");
const passport     = require("passport");
const morgan       = require("morgan");

const connectDB = require("./config/db");
require("./config/passport");

// ─── Rutas ────────────────────────────────────────────────
const authRoutes              = require("./routes/authRoutes");
const registerRoutes          = require("./routes/registerRoutes");
const termsRoutes             = require("./routes/termsRoutes");
const moderationRoutes        = require("./routes/moderationRoutes");
const chatRoutes              = require("./routes/chatRoutes");
const contactRoutes           = require("./routes/contacRoutes");
const communityRoutes         = require("./routes/communityRoutes");
const uploadRoutes            = require("./routes/uploadRoutes");
const ephemeralRoutes         = require("./routes/ephemeralRoutes");
const comunidadtemporalRoutes = require("./routes/comunidadtemporalRoutes");
const battleRoutes            = require("./routes/battleRoutes");
const getComunidadRoutes      = require("./routes/getComunidadRoute");
const superadminRoutes        = require("./routes/superadminRoutes");
const homestatsRoute          = require("./routes/homestatsRoute");
const nxControlRouter         = require("./routes/indexRoutes");
const notificacionRoutes      = require("./routes/notificacionRoutes");
const movieRoutes             = require("./routes/peliRoutes");
const moviesUpRoutes          = require("./routes/moviesUpRoutes");

const app  = express();
const PORT = process.env.PORT || 5000;

// ═══════════════════════════════════════════════════════════
// MIDDLEWARES
// ═══════════════════════════════════════════════════════════
app.use(cors({
  origin: process.env.CLIENT_URL || "http://localhost:3000",
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
}));

app.use(morgan("dev"));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

app.use(session({
  secret: process.env.SESSION_SECRET || "nakama_secret_dev",
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
    maxAge: 24 * 60 * 60 * 1000,
  },
}));

app.use(passport.initialize());
app.use(passport.session());

// ═══════════════════════════════════════════════════════════
// RUTAS
// ═══════════════════════════════════════════════════════════
app.use("/auth", authRoutes);
app.use("/register", registerRoutes);
app.use("/terms", termsRoutes);
app.use("/moderation", moderationRoutes);
app.use("/chats", chatRoutes);
app.use("/contacts", contactRoutes);
app.use("/comunidades", communityRoutes);
app.use("/uploads", uploadRoutes);
app.use("/ephemeral", ephemeralRoutes);
app.use("/comunidadtemporal", comunidadtemporalRoutes);
app.use("/battles", battleRoutes);
app.use("/comunidadinicial", getComunidadRoutes);
app.use("/superadmin", superadminRoutes);
app.use("/homestats", homestatsRoute);
app.use("/nx-control", nxControlRouter);
app.use("/notifications", notificacionRoutes);
app.use("/movies", movieRoutes);
app.use("/moviesup", moviesUpRoutes);

// Health check
app.get("/", (_req, res) => {
  res.json({
    status: "ok",
    app: "Nakama API",
    version: "1.0.0",
    timestamp: new Date().toISOString()
  });
});

// ─── Error handler global ─────────────────────────────────
app.use((err, _req, res, _next) => {
  console.error("[Error global]", err.message);
  res.status(err.status || 500).json({
    success: false,
    message: err.message || "Error interno."
  });
});

// ═══════════════════════════════════════════════════════════
// ARRANQUE
// ═══════════════════════════════════════════════════════════
async function startServer() {
  try {
    await connectDB();
    app.listen(PORT, () => {
      console.log(`🚀 Nakama API corriendo en puerto ${PORT}`);
    });
  } catch (error) {
    console.error("❌ Error al iniciar servidor:", error.message);
    process.exit(1);
  }
}

startServer();

module.exports = app;
