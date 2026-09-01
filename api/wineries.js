const SUPABASE_URL = process.env.SUPABASE_URL || 'https://lzeicurexdpludaltetf.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx6ZWljdXJleGRwbHVkYWx0ZXRmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc5NTY2NTMsImV4cCI6MjA5MzUzMjY1M30.94s0cX_FcJkUAJLT75MOo48ShZ0KZBRQUHVmdfSzf_8';

function esc(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;'); }

// Strips diacritics via Unicode NFD decomposition + combining-mark removal, so
// "Chateau" (from "Château") groups under C rather than falling through to "#".
function groupKey(name) {
  const stripped = String(name || '').normalize('NFD').replace(/[̀-ͯ]/g, '');
  const ch = (stripped[0] || '').toUpperCase();
  return /^[A-Z]$/.test(ch) ? ch : '#';
}
function groupAnchorId(key) { return key === '#' ? 'group-hash' : `group-${key.toLowerCase()}`; }

// Natural sort so "001 Vintners" < "26 Generazioni" < "689 Cellars" numerically,
// rather than as strings (where "26" < "689" only by lucky first-digit compare
// but "100" would sort before "26" lexicographically).
function naturalCompare(a, b) {
  const re = /(\d+)|(\D+)/g;
  const pa = a.match(re) || [];
  const pb = b.match(re) || [];
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const x = pa[i] || '', y = pb[i] || '';
    const nx = /^\d+$/.test(x), ny = /^\d+$/.test(y);
    if (nx && ny) {
      const diff = parseInt(x, 10) - parseInt(y, 10);
      if (diff !== 0) return diff;
    } else {
      const cmp = x.localeCompare(y);
      if (cmp !== 0) return cmp;
    }
  }
  return 0;
}

const FLAGS = { USA: '\ud83c\uddfa\ud83c\uddf8', France: '\ud83c\uddeb\ud83c\uddf7', Italy: '\ud83c\uddee\ud83c\uddf9', Spain: '\ud83c\uddea\ud83c\uddf8', Australia: '\ud83c\udde6\ud83c\uddfa', 'New Zealand': '\ud83c\uddf3\ud83c\uddff', Argentina: '\ud83c\udde6\ud83c\uddf7', Germany: '\ud83c\udde9\ud83c\uddea', Portugal: '\ud83c\uddf5\ud83c\uddf9', 'South Africa': '\ud83c\uddff\ud83c\udde6', Chile: '\ud83c\udde8\ud83c\uddf1' };
const COUNTRY_CODES = { us: 'USA', usa: 'USA', it: 'Italy', fr: 'France', es: 'Spain', au: 'Australia', nz: 'New Zealand', ar: 'Argentina', de: 'Germany', gb: 'UK', uk: 'UK' };
function normalizeCountry(c) { return COUNTRY_CODES[(c || '').toLowerCase()] || c || ''; }

function wineryCard(w, i) {
  const initials = esc(w.name.split(' ').filter(Boolean).slice(0, 2).map(x => x[0]).join('').toUpperCase());
  const flag = FLAGS[w.country] || '\ud83c\udf0d';
  const meta = w.region ? `${flag} ${esc(w.region)}, ${esc(w.country)}` : (w.country ? `${flag} ${esc(w.country)}` : '');
  const delay = (i % 12) * 0.04;
  const partnerBadge = w.affiliate_url ? ' <span class="partner-badge">Partner</span>' : '';
  return `<a class="winery-card" href="/winery.html?slug=${esc(w.slug)}" data-name="${esc(w.name.toLowerCase())}" style="animation-delay:${delay}s">
      <div class="winery-avatar">${initials}</div>
      <div class="winery-info">
        <div class="winery-card-name">${esc(w.name)}${partnerBadge}</div>
        ${meta ? `<div class="winery-card-meta">${meta}</div>` : ''}
      </div>
      <div class="winery-card-count">${w.count > 0 ? w.count + ' code' + (w.count !== 1 ? 's' : '') : 'View \u2192'}</div>
    </a>`;
}

function buildPage(wineries) {
  const count = wineries.length;
  const countText = `${count} winer${count !== 1 ? 'ies' : 'y'}`;
  const metaDesc = `Browse all ${count} wineries and wine retailers with active promo codes on HeyVino. Find discounts from Napa Valley, Sonoma, Long Island, Tuscany and more \u2014 updated daily.`;

  let gridHtml = '';
  let currentGroup = '';
  wineries.forEach((w, i) => {
    const group = w.group || groupKey(w.name);
    if (group !== currentGroup) {
      currentGroup = group;
      gridHtml += `<div class="letter-heading" id="${groupAnchorId(group)}">${esc(group)}</div>`;
    }
    gridHtml += wineryCard(w, i);
  });
  if (!gridHtml) {
    gridHtml = `<div style="text-align:center;padding:4rem;color:var(--muted);grid-column:1/-1"><div style="font-size:2.5rem;margin-bottom:1rem">\u26a0\ufe0f</div><div>Wineries are temporarily unavailable. Please refresh.</div></div>`;
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="canonical" href="https://www.heyvinowine.com/wineries.html">
<meta name="description" content="${esc(metaDesc)}">

<!-- Open Graph -->
<meta property="og:title" content="All Wineries with Promo Codes \u2014 HeyVino">
<meta property="og:description" content="${esc(metaDesc)}">
<meta property="og:url" content="https://www.heyvinowine.com/wineries.html">
<meta property="og:type" content="website">
<meta property="og:site_name" content="HeyVino">
<meta property="og:image" content="https://www.heyvinowine.com/images/og-image.png">

<!-- Twitter -->
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="All Wineries with Promo Codes \u2014 HeyVino">
<meta name="twitter:description" content="Browse ${count} wineries with active promo codes. Updated daily.">
<meta name="twitter:image" content="https://www.heyvinowine.com/images/og-image.png">

<!-- Structured data -->
<script type="application/ld+json">{"@context":"https://schema.org","@type":"CollectionPage","name":"All Wineries with Promo Codes","url":"https://www.heyvinowine.com/wineries.html","isPartOf":{"@type":"WebSite","name":"HeyVino","url":"https://www.heyvinowine.com/"}}</script>

<script async src="https://www.googletagmanager.com/gtag/js?id=G-7KDQWZYYV5"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());
  gtag('config', 'G-7KDQWZYYV5');
</script>

<title>All Wineries with Promo Codes \u2014 HeyVino</title>
<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,700;1,700&family=DM+Sans:wght@300;400;500;600&display=swap" rel="stylesheet">
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  :root {
    --wine: #6B1E2A; --wine-deep: #3D0D14; --wine-light: #9B3A4A;
    --gold: #C9A84C; --gold-light: #E8D5A0; --cream: #FAF6EF;
    --stone: #E8E0D4; --ink: #1A0A0E; --muted: #7A6E64; --white: #fff;
  }
  html { scroll-behavior: smooth; overflow-x: hidden; }
  body { font-family: 'DM Sans', sans-serif; background: var(--cream); color: var(--ink); min-height: 100vh; overflow-x: hidden; }
  ::-webkit-scrollbar { width: 6px; } ::-webkit-scrollbar-thumb { background: var(--gold); border-radius: 3px; }

  nav { position: sticky; top: 0; z-index: 100; background: var(--wine-deep); border-bottom: 1px solid rgba(201,168,76,0.25); padding: 0 1rem; display: flex; align-items: center; justify-content: space-between; height: 62px; }
  .nav-logo { display: flex; align-items: center; gap: 10px; }
  .nav-logo img { height: 44px; width: 44px; border-radius: 8px; object-fit: cover; }
  .nav-logo-text { font-family: 'Playfair Display', serif; font-size: 1.4rem; color: var(--gold); font-style: italic; font-weight: 700; }
  .nav-logo small { display: none; font-style: italic; color: rgba(201,168,76,0.55); font-size: 0.78rem; font-weight: 400; }
  .nav-links { display: none; gap: 1.75rem; list-style: none; align-items: center; }
  .nav-links a { color: rgba(255,255,255,0.7); text-decoration: none; font-size: 0.8rem; font-weight: 500; letter-spacing: 0.08em; text-transform: uppercase; transition: color 0.2s; }
  .nav-links a:hover { color: var(--gold); }
  .nav-cta { background: var(--gold); color: var(--wine-deep); padding: 7px 18px; border-radius: 2px; font-size: 0.78rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.1em; cursor: pointer; border: none; }

  .page-hero { background: linear-gradient(135deg, var(--wine-deep) 0%, var(--wine) 55%, #8B2535 100%); padding: 40px 1rem 48px; text-align: center; position: relative; overflow: hidden; }
  .page-hero::before { content:''; position:absolute; inset:0; background-image:url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='%23C9A84C' fill-opacity='0.05'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/svg%3E"); }
  .page-hero h1 { font-family: 'Playfair Display', serif; font-size: clamp(1.8rem, 4vw, 3rem); color: #fff; line-height: 1.15; margin-bottom: 0.75rem; position: relative; }
  .page-hero h1 em { color: var(--gold-light); }
  .page-hero p { color: rgba(255,255,255,0.68); font-size: 0.95rem; max-width: 480px; margin: 0 auto; line-height: 1.7; position: relative; }
  .winery-count { display: inline-block; margin-top: 1rem; font-size: 0.78rem; color: rgba(255,255,255,0.5); letter-spacing: 0.1em; text-transform: uppercase; position: relative; }

  .search-bar { max-width: 1400px; margin: 0 auto; padding: 1.25rem 1rem 0.5rem; }
  .search-wrap { display: flex; align-items: center; gap: 8px; background: var(--white); border: 1.5px solid var(--stone); border-radius: 4px; padding: 8px 14px; max-width: 420px; }
  .search-wrap input { border: none; outline: none; font-family: 'DM Sans', sans-serif; font-size: 0.85rem; color: var(--ink); width: 100%; background: transparent; }

  .wineries-wrap { max-width: 1400px; margin: 0 auto; padding: 1rem 1rem 3rem; }
  .wineries-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0.85rem; }

  .winery-card { background: var(--white); border: 1px solid var(--stone); border-radius: 8px; padding: 1rem; display: flex; align-items: center; gap: 12px; text-decoration: none; color: inherit; transition: box-shadow 0.2s, transform 0.2s, border-color 0.2s; animation: fadeUp 0.35s ease both; }
  .winery-card:hover { box-shadow: 0 6px 20px rgba(107,30,42,0.1); transform: translateY(-2px); border-color: var(--gold); }
  .winery-avatar { width: 42px; height: 42px; border-radius: 5px; border: 1px solid var(--stone); background: var(--cream); display: flex; align-items: center; justify-content: center; font-family: 'Playfair Display', serif; font-size: 0.95rem; color: var(--wine); font-weight: 700; flex-shrink: 0; }
  .winery-info { min-width: 0; flex: 1; }
  .winery-card-name { font-weight: 600; font-size: 0.85rem; color: var(--ink); line-height: 1.3; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .winery-card-meta { font-size: 0.7rem; color: var(--muted); margin-top: 2px; }
  .winery-card-count { flex-shrink: 0; font-size: 0.68rem; font-weight: 700; color: var(--wine); background: rgba(107,30,42,0.08); padding: 3px 8px; border-radius: 100px; white-space: nowrap; }
  .partner-badge { display: inline-block; padding: 2px 7px; margin-left: 4px; border-radius: 100px; font-size: 0.56rem; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; background: var(--wine); color: var(--gold); vertical-align: middle; }

  .letter-heading { font-family: 'Playfair Display', serif; color: var(--wine-deep); font-size: 1.1rem; margin: 1.5rem 0 0.6rem; padding-bottom: 0.4rem; border-bottom: 1px solid var(--stone); grid-column: 1 / -1; }

  .no-results { text-align: center; padding: 4rem 1rem; color: var(--muted); grid-column: 1 / -1; }

  footer { background: var(--wine-deep); padding: 2rem 1rem 1.5rem; margin-top: 2rem; }
  .footer-grid { display: none; }
  .footer-tagline { color: rgba(255,255,255,0.38); font-size: 0.83rem; line-height: 1.7; }
  .footer-heading { font-size: 0.67rem; text-transform: uppercase; letter-spacing: 0.15em; color: var(--gold); margin-bottom: 0.85rem; font-weight: 600; }
  .footer-links { list-style: none; display: flex; flex-direction: column; gap: 7px; }
  .footer-links a { color: rgba(255,255,255,0.42); font-size: 0.82rem; text-decoration: none; transition: color 0.15s; }
  .footer-links a:hover { color: var(--gold-light); }
  .footer-bottom { border-top: 1px solid rgba(201,168,76,0.16); padding-top: 1.25rem; max-width: 1400px; margin: 0 auto; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 1rem; }
  .footer-copy { font-size: 0.7rem; color: rgba(255,255,255,0.26); }
  .advertise-cta { background: transparent; border: 1px solid var(--gold); color: var(--gold); padding: 6px 16px; font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.1em; cursor: pointer; border-radius: 2px; text-decoration: none; }

  @keyframes fadeUp { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }

  @media (min-width: 480px) { .wineries-grid { grid-template-columns: repeat(2, 1fr); } }
  @media (min-width: 768px) {
    nav { padding: 0 2rem; }
    .nav-logo small { display: inline; }
    .nav-links { display: flex; }
    .page-hero { padding: 56px 2rem 64px; }
    .search-bar { padding: 1.5rem 2rem 0.5rem; }
    .wineries-wrap { padding: 1rem 2rem 3rem; }
    .wineries-grid { grid-template-columns: repeat(3, 1fr); gap: 1rem; }
    .footer-grid { display: grid; grid-template-columns: 2fr 1fr 1fr 1fr; gap: 2.5rem; max-width: 1400px; margin: 0 auto 2rem; }
    footer { padding: 2.5rem 2rem 1.5rem; }
  }
  @media (min-width: 1100px) { .wineries-grid { grid-template-columns: repeat(4, 1fr); } }
</style>
</head>
<body>

<nav>
  <div class="nav-logo">
    <a href="/" style="display:flex;align-items:center;gap:10px;text-decoration:none;">
      <img src="/images/logo.png" alt="HeyVino Logo"/>
      <span class="nav-logo-text">HeyVino<sup style="font-size: 0.5em; vertical-align: super;">\u2122</sup> <small>Wine deals, curated</small></span>
    </a>
  </div>
  <ul class="nav-links">
    <li><a href="/">Home</a></li>
    <li><a href="/wineries.html" style="color:var(--gold)">All Wineries</a></li>
    <li><a href="/partner.html">Partner With Us</a></li>
    <li><a href="/legacy.html">Legacy Promos</a></li>
    <li><a href="#" onclick="openAdvertiseModal();return false;">Advertise</a></li>
  </ul>
</nav>

<div class="page-hero">
  <h1>All Wine Promo Codes <em>by Winery</em></h1>
  <p>Browse every winery and retailer we track \u2014 with promo codes sourced daily from newsletters worldwide.</p>
  <div class="winery-count" id="wineryCount">${esc(countText)}</div>
</div>

<div class="search-bar">
  <div class="search-wrap">
    <span>\ud83d\udd0d</span>
    <input type="text" id="searchInput" placeholder="Search wineries\u2026" oninput="filterWineries()">
  </div>
</div>

<div class="wineries-wrap">
  <div class="wineries-grid" id="wineriesGrid">
    ${gridHtml}
    <div class="no-results" id="noResults" style="display:none"><div style="font-size:2rem;margin-bottom:0.75rem">\ud83c\udf7e</div><div>No wineries found</div></div>
  </div>
</div>

<footer>
  <div class="footer-grid">
    <div>
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:0.5rem;">
        <img src="/images/logo.png" alt="HeyVino" style="width:40px;height:40px;border-radius:8px;object-fit:cover;"/>
        <span style="font-family:'Playfair Display',serif;font-size:1.4rem;color:var(--gold);font-style:italic;">HeyVino<sup style="font-size: 0.5em; vertical-align: super;">\u2122</sup></span>
      </div>
      <p class="footer-tagline">The wine promo code aggregator \u2014 updated daily from ${count}+ winery newsletters worldwide.</p>
    </div>
    <div>
      <div class="footer-heading">Browse</div>
      <ul class="footer-links">
        <li><a href="/">All Deals</a></li>
        <li><a href="/wineries.html">By Winery</a></li>
        <li><a href="/region/napa-valley">Napa Valley</a></li>
        <li><a href="/region/sonoma">Sonoma</a></li>
        <li><a href="/region/long-island">Long Island</a></li>
        <li><a href="/region/paso-robles">Paso Robles</a></li>
        <li><a href="/region/washington">Washington</a></li>
        <li><a href="/region/oregon">Oregon</a></li>
        <li><a href="/region/lodi">Lodi</a></li>
      </ul>
    </div>
    <div>
      <div class="footer-heading">Business</div>
      <ul class="footer-links">
        <li><a href="#" onclick="openAdvertiseModal();return false;">Advertise With Us</a></li>
        <li><a href="#" onclick="openAdvertiseModal();return false;">Partner Vineyards</a></li>
      </ul>
    </div>
    <div>
      <div class="footer-heading">Company</div>
      <ul class="footer-links">
        <li><a href="/#about">About</a></li>
        <li><a href="/privacy.html">Privacy Policy</a></li>
        <li><a href="/terms.html">Terms of Service</a></li>
        <li><a href="#" onclick="openAdvertiseModal();return false;">Contact</a></li>
      </ul>
    </div>
  </div>
  <div class="footer-bottom">
    <p style="font-size:0.72rem;color:rgba(255,255,255,0.4);text-align:center;width:100%;margin:0 0 0.5rem;line-height:1.5;">HeyVino may earn a commission when you purchase through links on this site. This does not affect the codes or wineries we feature.</p>
    <span class="footer-legal-links" style="font-size:0.7rem;"><a href="/privacy.html" style="color:rgba(255,255,255,0.4);text-decoration:none;">Privacy Policy</a> &nbsp;\u00b7&nbsp; <a href="/terms.html" style="color:rgba(255,255,255,0.4);text-decoration:none;">Terms of Use</a></span>
    <span class="footer-copy">\u00a9 ${new Date().getFullYear()} HeyVino<sup style="font-size: 0.5em; vertical-align: super;">\u2122</sup> LLC \u00b7 HeyVinoWine.com \u00b7 Promotional codes sourced from publicly available winery communications.</span>
    <a class="advertise-cta" href="#" onclick="openAdvertiseModal();return false;">Advertise Here \u2192</a>
  </div>
</footer>

<script>
function filterWineries() {
  var q = document.getElementById('searchInput').value.toLowerCase().trim();
  var any = false;
  document.querySelectorAll('.winery-card').forEach(function(c) {
    var show = !q || c.dataset.name.indexOf(q) !== -1;
    c.style.display = show ? '' : 'none';
    if (show) any = true;
  });
  document.querySelectorAll('.letter-heading').forEach(function(h) { h.style.display = q ? 'none' : ''; });
  document.getElementById('noResults').style.display = any ? 'none' : '';
}

function openAdvertiseModal() { document.getElementById('advertiseModal').style.display = 'flex'; }
function closeAdvertiseModal() { document.getElementById('advertiseModal').style.display = 'none'; }
function copyAdvertiseEmail() {
  navigator.clipboard.writeText('HeyVinoMarketing@gmail.com');
  document.getElementById('copyEmailBtn').textContent = 'Copied!';
  setTimeout(function() { document.getElementById('copyEmailBtn').textContent = 'Copy'; }, 2000);
}
document.getElementById('advertiseModal').addEventListener('click', function(e) { if (e.target === this) closeAdvertiseModal(); });
</script>

<div id="advertiseModal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:1000;align-items:center;justify-content:center;">
  <div style="background:var(--cream);border-radius:8px;padding:2.5rem;max-width:420px;width:90%;text-align:center;position:relative;">
    <button onclick="closeAdvertiseModal()" style="position:absolute;top:12px;right:16px;background:none;border:none;font-size:1.4rem;cursor:pointer;color:var(--muted);">\u00d7</button>
    <div style="font-size:2.5rem;margin-bottom:1rem;">\ud83c\udf77</div>
    <h2 style="font-family:'Playfair Display',serif;color:var(--wine-deep);margin-bottom:0.75rem;font-size:1.3rem;">Work With HeyVino</h2>
    <p style="color:var(--muted);font-size:0.88rem;line-height:1.7;margin-bottom:1.5rem;">Interested in advertising or a promo code partnership? We'd love to hear from you. Reach out directly:</p>
    <div style="background:var(--wine-deep);border-radius:6px;padding:12px 16px;margin-bottom:1rem;display:flex;align-items:center;justify-content:space-between;gap:12px;">
      <span style="color:var(--gold);font-size:0.88rem;font-weight:600;">HeyVinoMarketing@gmail.com</span>
      <button id="copyEmailBtn" onclick="copyAdvertiseEmail()" style="background:var(--gold);color:var(--ink);border:none;padding:6px 14px;border-radius:3px;font-size:0.75rem;font-weight:700;cursor:pointer;white-space:nowrap;">Copy</button>
    </div>
    <a href="mailto:HeyVinoMarketing@gmail.com?subject=Advertise%20with%20HeyVino" style="display:block;background:var(--wine);color:white;padding:11px;border-radius:4px;font-size:0.85rem;font-weight:600;text-decoration:none;">Open in Email App \u2192</a>
  </div>
</div>

</body>
</html>`;
}

module.exports = async function handler(req, res) {
  const headers = { apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + SUPABASE_ANON_KEY };

  let wineries = [];
  try {
    const [wRes, pRes] = await Promise.all([
      fetch(`${SUPABASE_URL}/rest/v1/wineries?select=name,slug,region,country,affiliate_url,affiliate_network&is_active=eq.true`, { headers }),
      fetch(`${SUPABASE_URL}/rest/v1/promo_codes?select=winery_name&is_active=eq.true`, { headers }),
    ]);
    const rows = wRes.ok ? await wRes.json() : [];
    const codes = pRes.ok ? await pRes.json() : [];

    const codeCount = {};
    codes.forEach(row => {
      const key = (row.winery_name || '').toLowerCase();
      if (key) codeCount[key] = (codeCount[key] || 0) + 1;
    });

    wineries = rows
      .filter(w => w.name && w.slug)
      .map(w => ({
        name: w.name,
        slug: w.slug,
        country: normalizeCountry(w.country),
        region: w.region || '',
        count: codeCount[w.name.toLowerCase()] || 0,
        group: groupKey(w.name),
        affiliate_url: w.affiliate_url || '',
      }))
      .sort((a, b) => {
        if (a.group !== b.group) return a.group === '#' ? -1 : b.group === '#' ? 1 : a.group.localeCompare(b.group);
        return a.group === '#' ? naturalCompare(a.name, b.name) : a.name.localeCompare(b.name);
      });
  } catch (err) {
    console.error('wineries SSR error:', err);
    wineries = [];
  }

  const html = buildPage(wineries);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=3600');
  return res.status(200).send(html);
};

module.exports._internals = { buildPage, normalizeCountry, wineryCard, groupKey, groupAnchorId, naturalCompare };
