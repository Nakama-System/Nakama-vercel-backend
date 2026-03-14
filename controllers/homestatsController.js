const User = require("../models/User");
const Community = require("../models/Community");

// GET /api/homestats
const getHomeStats = async (req, res) => {
  try {
    const [userCount, communityCount] = await Promise.all([
      User.countDocuments(),
      Community.countDocuments(),
    ]);

    return res.status(200).json({
      otakus: userCount || 0,
      series: 0,        // modelo no disponible aún — siempre 0
      comunidades: communityCount || 0,
    });
  } catch (error) {
    console.error("Error en getHomeStats:", error);
    // En caso de error devolvemos 0 en todo para que el frontend no rompa
    return res.status(200).json({
      otakus: 0,
      series: 0,
      comunidades: 0,
    });
  }
};

module.exports = { getHomeStats };