const SUPABASE_URL = process.env.SUPABASE_URL || 'https://lzeicurexdpludaltetf.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx6ZWljdXJleGRwbHVkYWx0ZXRmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc5NTY2NTMsImV4cCI6MjA5MzUzMjY1M30.94s0cX_FcJkUAJLT75MOo48ShZ0KZBRQUHVmdfSzf_8';

function esc(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;'); }
function daysUntil(d) { return Math.ceil((new Date(d) - new Date()) / 86400000); }

// Canonical region pages. dbRegions lists every region value in the DB that
// rolls up under this landing page (mirrors the homepage REGION_GROUP_MAP).
const REGIONS = {
  'napa-valley': {
    title: 'Napa Valley',
    blurb: 'From Rutherford and Oakville to Howell Mountain and Stags Leap District, Napa Valley is home to America\u2019s most celebrated Cabernet producers.',
    dbRegions: ['Napa Valley', 'Calistoga', 'Carneros', 'Coombsville', 'Howell Mountain', 'Mount Veeder', 'Oakville', 'Pritchard Hill', 'Rutherford', 'Spring Mountain', 'St. Helena', 'Stags Leap District', 'Yountville'],
  },
  'sonoma': {
    title: 'Sonoma',
    blurb: 'Sonoma\u2019s diverse AVAs \u2014 Russian River Valley, Dry Creek, Alexander Valley and more \u2014 produce everything from cool-climate Pinot Noir to old-vine Zinfandel.',
    dbRegions: ['Sonoma', 'Alexander Valley', 'Chalk Hill', 'Dry Creek Valley', 'Knights Valley', 'Russian River Valley', 'Sonoma Coast', 'Sonoma County', 'Sonoma Mountain', 'Sonoma Valley'],
  },
  'long-island': {
    title: 'Long Island',
    blurb: 'New York\u2019s maritime wine country \u2014 the North Fork and the Hamptons \u2014 is known for Merlot, Cabernet Franc, and crisp coastal ros\u00e9.',
    dbRegions: ['Long Island', 'North Fork, Long Island', 'Hamptons, Long Island'],
  },
  'paso-robles': {
    title: 'Paso Robles',
    blurb: 'Paso Robles on California\u2019s Central Coast is famed for bold Rh\u00f4ne-style blends, Zinfandel, and Cabernet Sauvignon.',
    dbRegions: ['Paso Robles'],
  },
  'washington': {
    title: 'Washington',
    blurb: 'Washington State \u2014 including Walla Walla Valley \u2014 is America\u2019s second-largest wine producer, known for structured reds and vivid Rieslings.',
    dbRegions: ['Washington', 'Walla Walla Valley'],
  },
  'oregon': {
    title: 'Oregon',
    blurb: 'Oregon\u2019s Willamette Valley and beyond set the American benchmark for elegant, Burgundian-style Pinot Noir and Chardonnay.',
    dbRegions: ['Oregon'],
  },
  'lodi': {
    title: 'Lodi',
    blurb: 'Lodi is California\u2019s old-vine Zinfandel heartland, with family growers farming some of the state\u2019s most historic vineyards.',
    dbRegions: ['Lodi'],
  },
};

function inList(values) {
  return 'in.(' + values.map(v => '"' + v + '"').join(',') + ')';
}

function expiryText(expiry, offerType) {
  if (!expiry || offerType === 'welcome') return 'No current expiration';
  const d = daysUntil(expiry);
  if (isNaN(d)) return 'No current expiration';
  if (d < 0) return 'Expired';
  if (d <= 21) return '\u26a0\ufe0f ' + d + 'd left';
  return 'Exp ' + new Date(expiry).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function discountLabel(row) {
  if (row.discount_type === 'free_shipping') return 'Free shipping';
  if (row.discount_type === 'percentage' && row.discount_amount) return row.discount_amount + '% off';
  if (row.discount_type === 'fixed' && row.discount_amount) return '$' + row.discount_amount + ' off';
  return row.description || '';
}

function slugify(name) {
  return String(name || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function codeCard(row, wineryMetaByName) {
  const meta = wineryMetaByName[(row.winery_name || '').toLowerCase()] || {};
  const wslug = meta.slug || slugify(row.winery_name);
  const partnerBadge = meta.affiliate_url ? ' <span class="partner-badge">Partner</span>' : '';
  return `<div class="rcard">
    <a class="rcard-winery" href="/winery.html?slug=${esc(wslug)}">${esc(row.winery_name)}${partnerBadge}</a>
    <div class="rcard-code"><span class="rcode">${esc(row.code)}</span><button class="rcopy" data-code="${esc(row.code)}" data-winery="${esc(row.winery_name)}" onclick="copyCode(this)">Copy</button></div>
    <div class="rcard-meta">${esc(discountLabel(row))}${row.conditions ? '<span class="rcond"> \u00b7 ' + esc(row.conditions) + '</span>' : ''}</div>
    <div class="rcard-exp">${esc(expiryText(row.expiry_date, row.offer_type))}</div>
  </div>`;
}

function buildRegionPage({ regionSlug, region, codes, wineries }) {
  const canonical = 'https://www.heyvinowine.com/region/' + regionSlug;
  const title = esc(region.title) + ' Wine Promo Codes & Winery Deals | HeyVino';
  const metaDesc = esc(region.title + ' wine promo codes, verified daily. ' + codes.length + ' active code' + (codes.length !== 1 ? 's' : '') + ' from ' + wineries.length + ' ' + region.title + ' wineries \u2014 sourced directly from winery newsletters.');

  const wineryMetaByName = {};
  wineries.forEach(w => { wineryMetaByName[(w.name || '').toLowerCase()] = { slug: w.slug, affiliate_url: w.affiliate_url || '' }; });

  const ldJson = JSON.stringify({
    '@context': 'https://schema.org',
    '@graph': [
      { '@type': 'BreadcrumbList', itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Home', item: 'https://www.heyvinowine.com/' },
        { '@type': 'ListItem', position: 2, name: region.title, item: canonical },
      ]},
      { '@type': 'CollectionPage', name: region.title + ' Wine Promo Codes', url: canonical, description: region.blurb },
    ],
  }).replace(/</g, '\\u003c');

  const codesHtml = codes.length
    ? `<div class="rgrid">${codes.map(c => codeCard(c, wineryMetaByName)).join('\n')}</div>`
    : `<p class="rempty">No active codes in ${esc(region.title)} right now \u2014 check back soon, we update daily.</p>`;

  const wineriesHtml = wineries.length
    ? `<ul class="rwineries">${wineries.map(w => `<li><a href="/winery.html?slug=${esc(w.slug)}">${esc(w.name)}${w.affiliate_url ? ' <span class="partner-badge">Partner</span>' : ''}</a></li>`).join('')}</ul>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="description" content="${metaDesc}">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${metaDesc}">
<meta property="og:url" content="${canonical}">
<meta property="og:type" content="website">
<link rel="canonical" href="${canonical}">
<script type="application/ld+json">${ldJson}</script>
<script async src="https://www.googletagmanager.com/gtag/js?id=G-7KDQWZYYV5"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());
  gtag('config', 'G-7KDQWZYYV5');
</script>
<title>${title}</title>
<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,700;1,700&family=DM+Sans:wght@300;400;500;600&display=swap" rel="stylesheet">
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  :root { --wine:#6B1E2A; --wine-deep:#3D0D14; --gold:#C9A84C; --cream:#FAF6EF; --ink:#2A2523; --muted:#8a8580; }
  body { font-family:'DM Sans',sans-serif; background:var(--cream); color:var(--ink); }
  header { background:var(--wine-deep); padding:0.9rem 1.2rem; }
  header a.brand { font-family:'Playfair Display',serif; font-style:italic; font-size:1.25rem; color:var(--gold); text-decoration:none; }
  nav.crumbs { max-width:1080px; margin:1rem auto 0; padding:0 1.2rem; font-size:0.78rem; color:var(--muted); }
  nav.crumbs a { color:var(--wine); text-decoration:none; }
  main { max-width:1080px; margin:0 auto; padding:0.6rem 1.2rem 3rem; }
  h1 { font-family:'Playfair Display',serif; font-size:1.7rem; color:var(--wine-deep); margin:0.6rem 0 0.4rem; }
  p.blurb { font-size:0.92rem; color:var(--muted); max-width:680px; line-height:1.6; margin-bottom:1.4rem; }
  h2 { font-size:1.02rem; color:var(--wine); margin:1.8rem 0 0.8rem; }
  .rgrid { display:grid; grid-template-columns:repeat(auto-fill,minmax(250px,1fr)); gap:0.9rem; }
  .rcard { background:#fff; border:1px solid rgba(0,0,0,0.07); border-radius:10px; padding:0.9rem; }
  .rcard-winery { font-weight:600; color:var(--wine-deep); text-decoration:none; font-size:0.92rem; }
  .rcard-winery:hover { color:var(--wine); }
  .partner-badge { display:inline-block; padding:2px 7px; margin-left:4px; border-radius:100px; font-size:0.56rem; font-weight:700; letter-spacing:0.08em; text-transform:uppercase; background:var(--wine); color:var(--gold); vertical-align:middle; }
  .rcard-code { display:flex; align-items:center; justify-content:space-between; gap:8px; margin:0.6rem 0 0.45rem; border:1.5px dashed rgba(201,168,76,0.6); border-radius:7px; padding:6px 9px; background:rgba(201,168,76,0.06); }
  .rcode { font-family:'Courier New',monospace; font-weight:700; font-size:0.85rem; letter-spacing:0.06em; color:var(--wine-deep); overflow-wrap:anywhere; }
  .rcopy { background:var(--wine); color:#fff; border:none; border-radius:5px; padding:5px 12px; font-size:0.72rem; font-weight:600; cursor:pointer; font-family:inherit; }
  .rcopy.copied { background:#2D7A4F; }
  .rcard-meta { font-size:0.8rem; font-weight:600; color:var(--wine); }
  .rcond { font-weight:400; color:var(--muted); }
  .rcard-exp { font-size:0.7rem; color:var(--muted); margin-top:4px; }
  .rempty { color:var(--muted); font-size:0.9rem; }
  .rwineries { list-style:none; display:grid; grid-template-columns:repeat(auto-fill,minmax(210px,1fr)); gap:5px 18px; }
  .rwineries a { color:var(--ink); text-decoration:none; font-size:0.85rem; border-bottom:1px solid rgba(201,168,76,0.4); }
  .rwineries a:hover { color:var(--wine); }
  footer { margin-top:3rem; padding:1.4rem; background:var(--wine-deep); text-align:center; font-size:0.72rem; color:rgba(255,255,255,0.5); }
  footer a { color:var(--gold); text-decoration:none; }
</style>
</head>
<body>
<header><a class="brand" href="/">HeyVino\u2122</a></header>
<nav class="crumbs"><a href="/">Home</a> \u203a <a href="/wineries.html">Wineries</a> \u203a ${esc(region.title)}</nav>
<main>
  <h1>${esc(region.title)} Wine Promo Codes</h1>
  <p class="blurb">${esc(region.blurb)} Every code below was sourced directly from a winery newsletter and is verified before publishing \u2014 ${codes.length} active code${codes.length !== 1 ? 's' : ''} from ${wineries.length} ${esc(region.title)} winer${wineries.length !== 1 ? 'ies' : 'y'} right now.</p>
  <h2>Active Codes</h2>
  ${codesHtml}
  <h2>All ${esc(region.title)} Wineries on HeyVino</h2>
  ${wineriesHtml}
</main>
<footer>\u00a9 ${new Date().getFullYear()} HeyVino\u2122 LLC \u00b7 <a href="/">Home</a> \u00b7 <a href="/wineries.html">All Wineries</a> \u00b7 <a href="/privacy.html">Privacy</a> \u00b7 <a href="/terms.html">Terms</a></footer>
<script>
function copyCode(btn){
  navigator.clipboard.writeText(btn.dataset.code).then(function(){btn.textContent='\u2713 Copied';btn.classList.add('copied');setTimeout(function(){btn.textContent='Copy';btn.classList.remove('copied');},2000);});
  try{
    var payload=JSON.stringify({event:'code_copy',winery:btn.dataset.winery||'',code:btn.dataset.code||'',page:location.pathname+location.search});
    if(navigator.sendBeacon){navigator.sendBeacon('/api/track',new Blob([payload],{type:'application/json'}));}else{fetch('/api/track',{method:'POST',keepalive:true,headers:{'Content-Type':'application/json'},body:payload});}
  }catch(e){}
}
</script>
</body>
</html>`;
}

module.exports = async function handler(req, res) {
  const regionSlug = String(req.query?.region || '').toLowerCase().trim();
  const region = REGIONS[regionSlug];

  if (!region) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(404).send('<!DOCTYPE html><html><head><title>Region not found | HeyVino</title><meta name="robots" content="noindex"></head><body style="font-family:sans-serif;text-align:center;padding:4rem"><h1>Region not found</h1><p><a href="/">Back to HeyVino</a></p></body></html>');
  }

  const headers = { apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + SUPABASE_ANON_KEY };
  const filter = encodeURIComponent(inList(region.dbRegions));

  try {
    const [codesRes, wineriesRes] = await Promise.all([
      fetch(`${SUPABASE_URL}/rest/v1/promo_codes?select=*&is_active=eq.true&region=${filter}&order=is_featured.desc,winery_name.asc`, { headers }),
      fetch(`${SUPABASE_URL}/rest/v1/wineries?select=name,slug,affiliate_url,affiliate_network&is_active=eq.true&region=${filter}&order=name.asc`, { headers }),
    ]);
    const codes = codesRes.ok ? await codesRes.json() : [];
    const wineries = wineriesRes.ok ? await wineriesRes.json() : [];

    const html = buildRegionPage({ regionSlug, region, codes, wineries });
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=3600');
    return res.status(200).send(html);
  } catch (err) {
    console.error('region SSR error:', err);
    const html = buildRegionPage({ regionSlug, region, codes: [], wineries: [] });
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(200).send(html);
  }
};

module.exports._internals = { REGIONS, inList, buildRegionPage, slugify, expiryText, discountLabel };
