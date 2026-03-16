const Movie = require('../models/Movie');

const CAT_COLORS = {
  accion: '#e63946', aventura: '#ff9f43', comedia: '#26de81',
  drama: '#a29bfe', terror: '#636e72', romance: '#fd79a8',
  'sci-fi': '#00cec9', animacion: '#fdcb6e', documental: '#b2bec3',
  diversion: '#55efc4', amor: '#e84393', familia: '#74b9ff', otro: '#dfe6e9',
};

const AGE_META = {
  '+10': { label: '+10', color: '#f59e0b' },
  '+13': { label: '+13', color: '#f97316' },
  '+18': { label: '+18', color: '#ef4444' },
};

exports.getShareMoviePage = async (req, res) => {
  const { id } = req.query;

  // ── Redirige directo al reproductor si hay id ──────────
  const FRONT_URL = id
    ? `https://nakama-front.vercel.app/reproductor/${id}`
    : 'https://nakama-front.vercel.app/peliculas';

  let movie = null;
  if (id) {
    try {
      movie = await Movie.findById(id).lean();
    } catch (_) {}
  }

  const title       = movie?.title       || 'Nakama Universe';
  const description = movie?.description || 'Mirá esta película en Nakama Universe.';
  const thumbnail   = movie?.thumbnail   || 'https://nakama-front.vercel.app/assets/portadas.jpg';
  const year        = movie?.year        || '';
  const duration    = movie?.duration    || '';
  const category    = movie?.category    || 'otro';
  const ageRating   = movie?.ageRating   || 'all';
  const rating      = movie?.rating      != null ? Number(movie.rating).toFixed(1) : '0.0';
  const votes       = movie?.votesCount  || 0;

  const accent         = CAT_COLORS[category] || '#e63946';
  const ageMeta        = AGE_META[ageRating]  || null;
  const votesFormatted = votes > 999 ? `${(votes / 1000).toFixed(1)}K` : votes;
  const ratingNum      = parseFloat(rating);
  const circumference  = 2 * Math.PI * 18;

  const starsHtml = [1,2,3,4,5].map(n =>
    `<span style="color:${accent};opacity:${n <= Math.round(ratingNum) ? 1 : 0.25};font-size:16px;">★</span>`
  ).join('');

  const ageBadgeHtml = ageMeta
    ? `<div style="position:absolute;top:10px;left:10px;background:${ageMeta.color};color:#fff;font-size:11px;font-weight:700;padding:3px 8px;border-radius:5px;z-index:3">${ageMeta.label}</div>`
    : '';

  const metaParts = [year, duration, 'HD'].filter(Boolean);
  const metaHtml  = metaParts.map((m, i) =>
    i === 0
      ? `<span>${m}</span>`
      : `<span style="width:3px;height:3px;border-radius:50%;background:rgba(255,255,255,.3);display:inline-block;margin:0 2px;vertical-align:middle"></span><span>${m}</span>`
  ).join('');

  const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1.0,maximum-scale=1.0"/>
  <title>${title} — Nakama Universe</title>

  <meta property="og:type"         content="video.movie"/>
  <meta property="og:title"        content="${title} — Nakama Universe"/>
  <meta property="og:description"  content="${description.slice(0,160)}"/>
  <meta property="og:image"        content="${thumbnail}"/>
  <meta property="og:image:width"  content="1200"/>
  <meta property="og:image:height" content="630"/>
  <meta property="og:url"          content="https://nakama-vercel-backend.vercel.app/share-movie?id=${id}"/>
  <meta property="og:site_name"    content="Nakama Universe"/>
  <meta name="twitter:card"        content="summary_large_image"/>
  <meta name="twitter:title"       content="${title} — Nakama Universe"/>
  <meta name="twitter:description" content="${description.slice(0,160)}"/>
  <meta name="twitter:image"       content="${thumbnail}"/>

  <style>
    *, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }
    html { height: 100%; }

    body {
      min-height: 100vh;
      min-height: 100dvh;
      background: #0a0a0f;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 16px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      position: relative;
      overflow-x: hidden;
    }

    .bg-grid {
      position: fixed; inset: 0; z-index: 0; pointer-events: none;
      background-image:
        linear-gradient(rgba(230,57,70,.04) 1px, transparent 1px),
        linear-gradient(90deg, rgba(230,57,70,.04) 1px, transparent 1px);
      background-size: 40px 40px;
    }
    .orb {
      position: fixed; border-radius: 50%;
      pointer-events: none; z-index: 0;
      filter: blur(70px);
    }
    .orb-1 { width: 300px; height: 300px; top: -80px; right: -60px; background: rgba(230,57,70,.12); }
    .orb-2 { width: 250px; height: 250px; bottom: -60px; left: -50px; background: rgba(116,185,255,.08); }

    .card {
      position: relative; z-index: 2;
      width: 100%;
      max-width: 440px;
      background: rgba(255,255,255,.05);
      border: 1px solid rgba(255,255,255,.11);
      border-radius: 22px;
      overflow: hidden;
      backdrop-filter: blur(20px);
      -webkit-backdrop-filter: blur(20px);
      box-shadow: 0 20px 60px rgba(0,0,0,.5), 0 0 0 1px rgba(255,255,255,.04);
    }

    .thumb {
      position: relative;
      width: 100%;
      padding-top: 54%;
      overflow: hidden;
      background: #111;
    }
    .thumb img {
      position: absolute; inset: 0;
      width: 100%; height: 100%;
      object-fit: cover;
      display: block;
    }
    .thumb-overlay {
      position: absolute; inset: 0;
      background: linear-gradient(
        to bottom,
        rgba(0,0,0,.08) 0%,
        rgba(10,10,15,.0) 40%,
        rgba(10,10,15,.96) 100%
      );
    }
    .cat-badge {
      position: absolute; top: 10px; right: 10px; z-index: 3;
      background: ${accent}22;
      border: 1px solid ${accent}55;
      color: ${accent};
      font-size: 10px; font-weight: 700;
      padding: 3px 9px; border-radius: 6px;
      letter-spacing: .5px; text-transform: uppercase;
    }
    .play-btn {
      position: absolute; top: 50%; left: 50%;
      transform: translate(-50%, -50%);
      width: 58px; height: 58px; border-radius: 50%;
      background: ${accent}dd;
      display: flex; align-items: center; justify-content: center;
      text-decoration: none;
      box-shadow: 0 0 0 10px ${accent}22;
      transition: transform .15s, box-shadow .15s;
    }
    .play-btn:hover {
      transform: translate(-50%, -50%) scale(1.08);
      box-shadow: 0 0 0 14px ${accent}18;
    }
    .play-btn svg { width: 24px; height: 24px; fill: #fff; margin-left: 3px; }

    .body { padding: 20px 20px 22px; }

    .logo-row {
      display: flex; align-items: center; gap: 7px;
      margin-bottom: 13px;
    }
    .logo-dot {
      width: 8px; height: 8px; border-radius: 50%;
      background: ${accent}; flex-shrink: 0;
      animation: dotpulse 1.6s infinite;
    }
    @keyframes dotpulse {
      0%,100% { opacity:1; transform:scale(1); }
      50%      { opacity:.4; transform:scale(1.45); }
    }
    .logo-txt {
      font-size: 10px; font-weight: 700;
      color: rgba(255,255,255,.3);
      letter-spacing: 2.5px; text-transform: uppercase;
    }

    .movie-title {
      font-size: 22px; font-weight: 800;
      color: #fff; line-height: 1.2;
      margin-bottom: 8px;
      word-break: break-word;
    }
    .movie-meta {
      display: flex; align-items: center; flex-wrap: wrap; gap: 6px;
      font-size: 12px; color: rgba(255,255,255,.4);
      margin-bottom: 10px;
    }
    .movie-desc {
      font-size: 13px; color: rgba(255,255,255,.48);
      line-height: 1.65; margin-bottom: 16px;
    }

    .stars-row {
      display: flex; align-items: center; gap: 1px;
      margin-bottom: 18px; flex-wrap: wrap;
    }
    .rating-val {
      font-size: 14px; font-weight: 700;
      color: ${accent}; margin-left: 8px;
    }
    .rating-cnt {
      font-size: 12px; color: rgba(255,255,255,.3);
      margin-left: 4px;
    }

    .countdown-box {
      display: flex; align-items: center; gap: 14px;
      background: ${accent}0e;
      border: 1px solid ${accent}22;
      border-radius: 14px;
      padding: 14px 16px;
      margin-bottom: 14px;
    }
    .cd-circle { position: relative; width: 44px; height: 44px; flex-shrink: 0; }
    .cd-svg    { transform: rotate(-90deg); }
    .cd-track  { fill: none; stroke: ${accent}20; stroke-width: 3.5; }
    .cd-fill   {
      fill: none; stroke: ${accent}; stroke-width: 3.5;
      stroke-linecap: round;
      stroke-dasharray: ${circumference.toFixed(2)};
      stroke-dashoffset: 0;
      transition: stroke-dashoffset 1s linear;
    }
    .cd-num {
      position: absolute; inset: 0;
      display: flex; align-items: center; justify-content: center;
      font-size: 15px; font-weight: 800; color: ${accent};
    }
    .cd-text {
      font-size: 13px; color: rgba(255,255,255,.48);
      line-height: 1.55; flex: 1;
    }
    .cd-text strong { color: rgba(255,255,255,.8); font-weight: 600; }

    .watch-btn {
      display: flex; align-items: center; justify-content: center; gap: 9px;
      width: 100%; padding: 14px;
      background: ${accent};
      color: #fff; font-size: 15px; font-weight: 700;
      border: none; border-radius: 12px;
      cursor: pointer; text-decoration: none;
      letter-spacing: .3px;
      transition: opacity .15s, transform .1s;
    }
    .watch-btn:hover  { opacity: .9; transform: scale(1.01); }
    .watch-btn:active { transform: scale(.98); }
    .watch-btn svg    { width: 16px; height: 16px; fill: #fff; }

    .powered {
      position: relative; z-index: 2;
      width: 100%; max-width: 440px;
      text-align: center;
      margin-top: 14px;
      font-size: 11px;
      color: rgba(255,255,255,.18);
      letter-spacing: .6px;
    }
    .powered span { color: ${accent}77; font-weight: 700; }

    @media (max-width: 480px) {
      body { padding: 12px 12px 20px; justify-content: flex-start; padding-top: 24px; }
      .card { border-radius: 18px; }
      .movie-title { font-size: 19px; }
      .body { padding: 16px 16px 20px; }
      .countdown-box { padding: 12px 13px; gap: 11px; }
      .watch-btn { padding: 13px; font-size: 14px; }
    }

    @media (max-width: 360px) {
      .movie-title { font-size: 17px; }
      .cd-text { font-size: 12px; }
    }
  </style>
</head>
<body>
  <div class="bg-grid"></div>
  <div class="orb orb-1"></div>
  <div class="orb orb-2"></div>

  <div class="card">
    <div class="thumb">
      <img src="${thumbnail}" alt="${title}" loading="eager"/>
      <div class="thumb-overlay"></div>
      ${ageBadgeHtml}
      <div class="cat-badge">${category.toUpperCase()}</div>
      <a class="play-btn" href="${FRONT_URL}">
        <svg viewBox="0 0 24 24"><polygon points="5,3 19,12 5,21"/></svg>
      </a>
    </div>

    <div class="body">
      <div class="logo-row">
        <div class="logo-dot"></div>
        <span class="logo-txt">Nakama Universe</span>
      </div>

      <div class="movie-title">${title}</div>
      <div class="movie-meta">${metaHtml}</div>
      <div class="movie-desc">${description.slice(0,130)}${description.length > 130 ? '…' : ''}</div>

      <div class="stars-row">
        ${starsHtml}
        <span class="rating-val">${rating}</span>
        <span class="rating-cnt">(${votesFormatted} votos)</span>
      </div>

      <div class="countdown-box">
        <div class="cd-circle">
          <svg class="cd-svg" viewBox="0 0 44 44" width="44" height="44">
            <circle class="cd-track" cx="22" cy="22" r="18"/>
            <circle class="cd-fill" id="cdFill" cx="22" cy="22" r="18"/>
          </svg>
          <div class="cd-num" id="cdNum">3</div>
        </div>
        <div class="cd-text">
          Redirigiendo en <strong id="cdSec">3 segundos</strong><br>
          para que puedas ver esta película.
        </div>
      </div>

      <a class="watch-btn" href="${FRONT_URL}">
        <svg viewBox="0 0 24 24"><polygon points="5,3 19,12 5,21"/></svg>
        Ver ahora en Nakama
      </a>
    </div>
  </div>

  <p class="powered">powered by <span>NAKAMA UNIVERSE</span></p>

  <script>
    const DEST = '${FRONT_URL}';
    const circ = ${circumference.toFixed(2)};
    const fillEl = document.getElementById('cdFill');
    const numEl  = document.getElementById('cdNum');
    const secEl  = document.getElementById('cdSec');
    fillEl.style.strokeDasharray  = circ;
    fillEl.style.strokeDashoffset = 0;
    let t = 3;
    const iv = setInterval(() => {
      t--;
      fillEl.style.strokeDashoffset = circ * (1 - t / 3);
      numEl.textContent = t > 0 ? t : '→';
      secEl.textContent = t === 1 ? '1 segundo' : t > 0 ? t + ' segundos' : 'ahora';
      if (t <= 0) { clearInterval(iv); window.location.href = DEST; }
    }, 1000);
  </script>
</body>
</html>`;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=60');
  return res.status(200).send(html);
};
