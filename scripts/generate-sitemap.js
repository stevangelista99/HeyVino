const fs = require('fs');
const path = require('path');
const { REGION_GROUPS } = require('../lib/regions');

const SUPABASE_URL = 'https://lzeicurexdpludaltetf.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx6ZWljdXJleGRwbHVkYWx0ZXRmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc5NTY2NTMsImV4cCI6MjA5MzUzMjY1M30.94s0cX_FcJkUAJLT75MOo48ShZ0KZBRQUHVmdfSzf_8';
const BASE_URL = 'https://www.heyvinowine.com';

const today = new Date().toISOString().split('T')[0];

function urlEntry(loc, priority = '0.8', lastmod = today) {
  return `  <url>\n    <loc>${loc}</loc>\n    <lastmod>${lastmod}</lastmod>\n    <priority>${priority}</priority>\n  </url>`;
}

// Replaces every occurrence of `oldStr` in `content` with `newStr`, but throws
// if the count of occurrences found doesn't match `expected`. This is
// deliberately strict: a silent 0-match (page copy changed) or unexpected
// multi-match must stop the script rather than write a corrupted file.
function escapeRegex(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

// Replaces a recurring "NNN+" number inside a larger, uniquely-anchored
// string. Uses \d+ so this matches whether it's the original hardcoded
// number OR a number written by a previous run — safe to run every time.
function replaceRecurringNumber(content, template, newNumber, label) {
  const pattern = new RegExp(escapeRegex(template).replace('__NUM__', '\\d+'), 'g');
  const matches = content.match(pattern);
  if (!matches || matches.length !== 1) {
    throw new Error(`updateHomepageStats: expected exactly 1 match for "${label}", found ${matches ? matches.length : 0}. Aborting — index.html markup may have changed.`);
  }
  return content.replace(pattern, template.replace('__NUM__', newNumber));
}

// Applies a one-time content swap (e.g. old copy -> new copy) ONLY if the
// old text is still present. If it's already been applied by a previous
// run, this is a no-op — NOT an error, since re-running is expected.
function replaceOnce(content, oldStr, newStr, label) {
  const count = content.split(oldStr).length - 1;
  if (count === 0) return content; // already applied previously — fine
  if (count > 1) {
    throw new Error(`updateHomepageStats: expected at most 1 occurrence of "${label}", found ${count}. Aborting — index.html markup may have changed.`);
  }
  return content.split(oldStr).join(newStr);
}

function updateHomepageStats(wineries) {
  const indexPath = path.join(__dirname, '..', 'index.html');
  let html = fs.readFileSync(indexPath, 'utf8');

  const wineryCount = wineries.length;
  const roundedCount = Math.floor(wineryCount / 10) * 10; // e.g. 296 -> 290+, avoids the number looking wrong if a few wineries get deactivated
  const countryCount = new Set(wineries.map(w => (w.country || '').trim()).filter(Boolean)).size;

  // ── One-time content swaps — run FIRST, while original word-based/NZ
  // copy is still intact. Silently skipped on subsequent runs once the
  // old copy is gone (this is what makes re-running the script safe). ──
  html = replaceOnce(html,
    'Real promo codes from 250+ wineries worldwide — Napa, Burgundy, Tuscany, NZ and more. Updated daily, free to browse.',
    `Real promo codes from ${roundedCount}+ wineries worldwide — Napa, Burgundy, Tuscany, Long Island and more. Updated daily, free to browse.`,
    'meta description NZ->Long Island');
  html = replaceOnce(html,
    'Real promo codes from real wineries — Napa Cab, Burgundy, Tuscany, New Zealand and more. Updated daily, direct from the source.',
    'Real promo codes from real wineries — Napa Cab, Burgundy, Tuscany, Long Island and more. Updated daily, direct from the source.',
    'hero subhead');
  html = replaceOnce(html,
    '<div><span class="stat-num">Top</span><span class="stat-label">Wineries</span></div>',
    `<div><span class="stat-num">${roundedCount}+</span><span class="stat-label">Wineries</span></div>`,
    'hero stat: wineries (first-run migration)');
  html = replaceOnce(html,
    '<div><span class="stat-num">Global</span><span class="stat-label">Regions</span></div>',
    `<div><span class="stat-num">${countryCount}</span><span class="stat-label">Countries</span></div>`,
    'hero stat: countries (first-run migration)');

  // ── Recurring numeric updates — idempotent, run every time after the
  // migrations above. Each template includes unique surrounding markup
  // so tags with similar text (og:description / twitter:description)
  // can never cross-match. ──
  html = replaceRecurringNumber(html,
    '<meta name="description" content="Real promo codes from __NUM__+ wineries worldwide',
    roundedCount, 'meta description');
  html = replaceRecurringNumber(html,
    '<meta property="og:description" content="Real promo codes from __NUM__+ wineries worldwide',
    roundedCount, 'og:description');
  html = replaceRecurringNumber(html,
    '<meta name="twitter:description" content="Real promo codes from __NUM__+ wineries worldwide',
    roundedCount, 'twitter:description');
  html = replaceRecurringNumber(html,
    '"description":"Wine promo code aggregator — updated daily from __NUM__+ winery newsletters worldwide."',
    roundedCount, 'JSON-LD description');
  html = replaceRecurringNumber(html,
    '<div class="hero-eyebrow">🍷 Codes from __NUM__+ wineries worldwide</div>',
    roundedCount, 'hero eyebrow');
  html = replaceRecurringNumber(html,
    '<p class="footer-tagline">The wine promo code aggregator — updated daily from __NUM__+ winery newsletters worldwide.</p>',
    roundedCount, 'footer tagline');
  html = replaceRecurringNumber(html,
    '<div><span class="stat-num">__NUM__+</span><span class="stat-label">Wineries</span></div>',
    roundedCount, 'hero stat: wineries');
  html = replaceRecurringNumber(html,
    '<div><span class="stat-num">__NUM__</span><span class="stat-label">Countries</span></div>',
    countryCount, 'hero stat: countries');

  fs.writeFileSync(indexPath, html, 'utf8');
  console.log(`index.html stats updated — ${roundedCount}+ wineries, ${countryCount} countries (${today})`);
}

async function generate() {
  const headers = { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${SUPABASE_ANON_KEY}` };

  const [wRes, pRes] = await Promise.all([
    fetch(`${SUPABASE_URL}/rest/v1/wineries?select=name,slug,description,country,created_at,affiliate_url,affiliate_network&is_active=eq.true`, { headers }),
    fetch(`${SUPABASE_URL}/rest/v1/promo_codes?select=winery_name,created_at,updated_at,region&is_active=eq.true`, { headers })
  ]);
  if (!wRes.ok) throw new Error(`Supabase error: HTTP ${wRes.status}`);
  const wineries = await wRes.json();
  const codes = pRes.ok ? await pRes.json() : [];

  // Which wineries currently have active codes
  const hasCode = new Set(codes.map(r => (r.winery_name || '').toLowerCase()).filter(Boolean));

  // Per-winery lastmod: the newest code activity for that winery (created or
  // updated), falling back to the winery row's own created_at. Using real
  // dates instead of stamping every URL with today's date keeps the lastmod
  // field trustworthy for crawlers.
  const toDay = (iso) => (iso || '').split('T')[0];
  const latestCodeDate = {};
  codes.forEach(r => {
    const key = (r.winery_name || '').toLowerCase();
    if (!key) return;
    const d = [r.updated_at, r.created_at].filter(Boolean).map(toDay).sort().pop() || '';
    if (d && (!latestCodeDate[key] || d > latestCodeDate[key])) latestCodeDate[key] = d;
  });

  // Only index a winery page if it has codes OR a written description — never empty pages
  const indexable = wineries
    .filter(w => w.slug && (hasCode.has((w.name || '').toLowerCase()) || (w.description && w.description.trim())))
    .map(w => ({
      slug: w.slug,
      lastmod: latestCodeDate[(w.name || '').toLowerCase()] || toDay(w.created_at) || today,
    }))
    .sort((a, b) => a.slug.localeCompare(b.slug));
  const slugs = indexable.map(w => w.slug);

  // A region page only earns a sitemap entry once it has at least one active
  // code — same exact-string-equality match against REGION_GROUPS' values as
  // api/region.js's own query uses, applied here to the region column already
  // present on the promo_codes rows fetched above (no separate query needed).
  const activeRegionValues = new Set(codes.map(r => r.region).filter(Boolean));
  const REGION_SLUGS = Object.keys(REGION_GROUPS)
    .filter(slug => REGION_GROUPS[slug].values.some(v => activeRegionValues.has(v)));
  const staticEntries = [
    urlEntry(`${BASE_URL}/`, '1.0'),
    urlEntry(`${BASE_URL}/wineries.html`, '0.9'),
    ...REGION_SLUGS.map(r => urlEntry(`${BASE_URL}/region/${r}`, '0.8')),
    urlEntry(`${BASE_URL}/legacy.html`, '0.7'),
    urlEntry(`${BASE_URL}/partner.html`, '0.6'),
  ];
  const entries = [
    ...staticEntries,
    ...indexable.map(w => urlEntry(`${BASE_URL}/winery.html?slug=${w.slug}`, '0.7', w.lastmod)),
  ];

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries.join('\n')}
</urlset>`;

  const outPath = path.join(__dirname, '..', 'sitemap.xml');
  fs.writeFileSync(outPath, xml, 'utf8');
  console.log(`sitemap.xml written — ${slugs.length} winery URLs + ${staticEntries.length} static (${today})`);

  updateHomepageStats(wineries);
}

generate().catch(err => { console.error(err.message); process.exit(1); });
