const Movie = require('../models/Movie'); // ajustá el path a tu modelo

const FRONT_URL = 'https://nakama-front.vercel.app/peliculas';

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

  const accent          = CAT_COLORS[category] || '#e63946';
  const ageMeta         = AGE_META[ageRating]  || null;
  const votesFormatted  = votes > 999 ? `${(votes / 1000).toFixed(1)}K` : votes;
  const ratingNum       = parseFloat(rating);
  const circumference   = 2 * Math.PI * 18;

  const starsHtml = [1,2,3,4,5].map(n =>
    `<span style="color:${accent};opacity:${n <= Math.round(ratingNum) ? 1 : 0.25}">★</span>`
  ).join('');

  const ageBadgeHtml = ageMeta
    ? `<div style="position:absolute;top:10px;left:10px;background:${ageMeta.color};color:#fff;font-size:10px;font-weight:700;padding:2px 7px;border-radius:5px">${ageMeta.label}</div>`
    : '';

  const metaHtml = [year, duration, 'HD']
    .filter(Boolean)
    .map((m, i) => i === 0
      ? `<span>${m}</span>`
      : `<div class="meta-sep"></div><span>${m}</span>`)
    .join('');

  const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1.0"/>
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
    *,*::before,*::after{margin:0;padding:0;box-sizing:border-box}
    html,body{height:100%;font-family:-apple-system,BlinkMacSystemFont,'Inter',sans-serif}
    body{min-height:100vh;background:#0a0a0f;display:flex;align-items:center;justify-content:center;padding:20px;overflow:hidden;position:relative}
    .bg-grid{position:fixed;inset:0;background-image:linear-gradient(rgba(230,57,70,.04) 1px,transparent 1px),linear-gradient(90deg,rgba(230,57,70,.04) 1px,transparent 1px);background-size:40px 40px;pointer-events:none;z-index:0}
    .orb{position:fixed;border-radius:50%;pointer-events:none;filter:blur(80px);z-index:0}
    .orb-1{width:350px;height:350px;top:-100px;right:-80px;background:rgba(230,57,70,.1)}
    .orb-2{width:280px;height:280px;bottom:-80px;left:-60px;background:rgba(116,185,255,.07)}
    .card{width:100%;max-width:420px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.1);border-radius:20px;overflow:hidden;position:relative;z-index:2;backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px)}
    .thumb{position:relative;width:100%;padding-top:56.25%;overflow:hidden}
    .thumb img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
    .thumb-overlay{position:absolute;inset:0;background:linear-gradient(to bottom,rgba(0,0,0,.05) 0%,rgba(10,10,15,.95) 100%)}
    .play-btn{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:56px;height:56px;border-radius:50%;background:${accent}dd;display:flex;align-items:center;justify-content:center;box-shadow:0 0 0 8px ${accent}22;transition:transform .15s;text-decoration:none}
    .play-btn:hover{transform:translate(-50%,-50%) scale(1.08)}
    .play-btn svg{width:24px;height:24px;fill:#fff;margin-left:3px}
    .cat-badge{position:absolute;top:10px;right:10px;background:${accent}22;border:1px solid ${accent}55;color:${accent};font-size:10px;font-weight:700;padding:3px 8px;border-radius:6px;letter-spacing:.5px;text-transform:uppercase}
    .body{padding:18px 20px}
    .logo-row{display:flex;align-items:center;gap:7px;margin-bottom:14px}
    .logo-dot{width:8px;height:8px;border-radius:50%;background:${accent};animation:pulse 1.6s infinite}
    @keyframes pulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.5;transform:scale(1.4)}}
    .logo-txt{font-size:11px;font-weight:700;color:rgba(255,255,255,.35);letter-spacing:2px;text-transform:uppercase}
    .movie-title{font-size:20px;font-weight:800;color:#fff;line-height:1.25;margin-bottom:7px}
    .movie-meta{display:flex;align-items:center;gap:8px;font-size:12px;color:rgba(255,255,255,.4);margin-bottom:9px}
    .meta-sep{width:3px;height:3px;border-radius:50%;background:rgba(255,255,255,.22)}
    .movie-desc{font-size:13px;color:rgba(255,255,255,.5);line-height:1.65;margin-bottom:15px}
    .stars-row{display:flex;align-items:center;gap:2px;margin-bottom:16px}
    .rating-val{font-size:13px;font-weight:700;color:${accent};margin-left:7px}
    .rating-cnt{font-size:12px;color:rgba(255,255,255,.3)}
    .countdown-box{display:flex;align-items:center;gap:13px;background:${accent}0f;border:1px solid ${accent}25;border-radius:12px;padding:13px 15px;margin-bottom:13px}
    .cd-circle{position:relative;width:42px;height:42px;flex-shrink:0}
    .cd-svg{transform:rotate(-90deg)}
    .cd-track{fill:none;stroke:${accent}22;stroke-width:3.5}
    .cd-fill{fill:none;stroke:${accent};stroke-width:3.5;stroke-linecap:round;stroke-dasharray:${circumference.toFixed(2)};stroke-dashoffset:0;transition:stroke-dashoffset 1s linear}
    .cd-num{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:15px;font-weight:800;color:${accent}}
    .cd-text{font-size:12.5px;color:rgba(255,255,255,.5);line-height:1.55}
    .cd-text strong{color:rgba(255,255,255,.8);font-weight:600}
    .watch-btn{display:flex;align-items:center;justify-content:center;gap:8px;width:100%;padding:13px;background:${accent};color:#fff;font-size:14px;font-weight:700;border:none;border-radius:10px;cursor:pointer;text-decoration:none;letter-spacing:.4px;transition:opacity .15s,transform .1s}
    .watch-btn:hover{opacity:.9;transform:scale(1.01)}
    .watch-btn svg{width:16px;height:16px;fill:#fff}
    .powered{text-align:center;margin-top:14px;font-size:11px;color:rgba(255,255,255,.18);letter-spacing:.5px;position:relative;z-index:2}
    .powered span{color:${accent}88;font-weight:700}
    @media(max-width:400px){.body{padding:15px 16px}.movie-title{font-size:18px}}
  </style>
</head>
<body>
  <div class="bg-grid"></div>
  <div class="orb orb-1"></div>
  <div class="orb orb-2"></div>
  <div class="card">
    <div class="thumb">
      <img src="${thumbnail}" alt="${title}"/>
      <div class="thumb-overlay"></div>
      ${ageBadgeHtml}
      <div class="cat-badge">${category.toUpperCase()}</div>
      <a class="play-btn" href="${FRONT_URL}" id="mainLink">
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
      <div class="stars-row">${starsHtml}<span class="rating-val">${rating}</span><span class="rating-cnt">(${votesFormatted} votos)</span></div>
      <div class="countdown-box">
        <div class="cd-circle">
          <svg class="cd-svg" viewBox="0 0 42 42" width="42" height="42">
            <circle class="cd-track" cx="21" cy="21" r="18"/>
            <circle class="cd-fill" id="cdFill" cx="21" cy="21" r="18"/>
          </svg>
          <div class="cd-num" id="cdNum">3</div>
        </div>
        <div class="cd-text">Redirigiendo al catálogo en <strong id="cdSec">3 segundos</strong><br>para que puedas ver esta película.</div>
      </div>
      <a class="watch-btn" href="${FRONT_URL}">
        <svg viewBox="0 0 24 24"><polygon points="5,3 19,12 5,21"/></svg>
        Ver ahora en Nakama
      </a>
    </div>
  </div>
  <p class="powered">powered by <span>NAKAMA UNIVERSE</span></p>
  <script>
    const DEST='${FRONT_URL}';
    const circ=${circumference.toFixed(2)};
    const fillEl=document.getElementById('cdFill');
    const numEl=document.getElementById('cdNum');
    const secEl=document.getElementById('cdSec');
    fillEl.style.strokeDasharray=circ;
    fillEl.style.strokeDashoffset=0;
    let t=3;
    const iv=setInterval(()=>{
      t--;
      fillEl.style.strokeDashoffset=circ*(1-t/3);
      numEl.textContent=t>0?t:'→';
      secEl.textContent=t===1?'1 segundo':t>0?t+' segundos':'ahora';
      if(t<=0){clearInterval(iv);window.location.href=DEST;}
    },1000);
  </script>
</body>
</html>`;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=60');
  return res.status(200).send(html);
};