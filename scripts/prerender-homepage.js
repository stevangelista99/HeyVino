// Prerenders active deals into index.html so crawlers see real content
// instead of "Loading…". Injects static HTML between the PRERENDER markers
// inside #cardGroups; the client-side loadCodes() replaces it with live data
// once the Supabase fetch completes. Idempotent — safe to run repeatedly.
//
// Run after any promo refresh, alongside generate-sitemap.js:
//   node scripts/prerender-homepage.js

const fs = require('fs');
const path = require('path');

const SUPABASE_URL = 'https://lzeicurexdpludaltetf.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx6ZWljdXJleGRwbHVkYWx0ZXRmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc5NTY2NTMsImV4cCI6MjA5MzUzMjY1M30.94s0cX_FcJkUAJLT75MOo48ShZ0KZBRQUHVmdfSzf_8';

const START = '<!-- PRERENDER:START -->';
const END = '<!-- PRERENDER:END -->';
const MAX_CARDS = 24; // enough for crawlers; live JS shows the full set

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#x27;');
}

function offerText(row) {
  const amt = String(row.discount_amount || '').trim();
  switch (row.discount_type) {
    case 'percentage': return amt ? `${amt}% off` : 'Discount';
    case 'fixed': return amt ? `$${amt} off` : 'Discount';
    case 'free_shipping': return 'Free shipping';
    default: return row.description ? '' : 'Special offer';
  }
}

function cardHtml(row) {
  const winery = esc(row.winery_name);
  const offer = esc(offerText(row));
  const desc = esc((row.description || '').trim());
  const code = esc(row.code);
  const region = esc([row.region, row.country].filter(Boolean).join(', '));
  return [
    '<article class="prerender-card" style="border:1px solid rgba(0,0,0,0.08);border-radius:8px;padding:14px 16px;margin:0 0 10px;background:#fff;">',
    `<h3 style="margin:0 0 2px;font-size:1rem;">${winery}</h3>`,
    region ? `<div style="font-size:0.75rem;color:#8a8580;margin-bottom:6px;">${region}</div>` : '',
    `<p style="margin:0 0 6px;font-size:0.88rem;">${[offer, desc].filter(Boolean).join(' — ')}</p>`,
    `<p style="margin:0;font-size:0.85rem;">Code: <code>${code}</code></p>`,
    '</article>',
  ].filter(Boolean).join('');
}

async function fetchActiveCodes() {
  const url = `${SUPABASE_URL}/rest/v1/promo_codes` +
    `?select=winery_name,code,discount_amount,discount_type,description,region,country,is_featured` +
    `&is_active=eq.true&order=is_featured.desc,winery_name.asc&limit=${MAX_CARDS}`;
  const res = await fetch(url, {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
  });
  if (!res.ok) throw new Error(`Supabase fetch failed: HTTP ${res.status}`);
  return res.json();
}

async function main() {
  const indexPath = path.join(__dirname, '..', 'index.html');
  const html = fs.readFileSync(indexPath, 'utf8');

  const startIdx = html.indexOf(START);
  const endIdx = html.indexOf(END);
  if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) {
    throw new Error('PRERENDER markers not found (or malformed) in index.html — aborting without writing.');
  }

  const rows = await fetchActiveCodes();
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error('No active promo codes returned — refusing to prerender an empty section.');
  }

  const block = [
    '<section aria-label="Current wine deals">',
    `<h2 style="font-size:1.1rem;margin:0 0 10px;">Current Wine Promo Codes</h2>`,
    rows.map(cardHtml).join('\n'),
    '</section>',
  ].join('\n');

  const updated = html.slice(0, startIdx + START.length) + '\n' + block + '\n' + html.slice(endIdx);
  fs.writeFileSync(indexPath, updated);
  console.log(`Prerendered ${rows.length} deal cards into index.html`);
}

main().catch((err) => { console.error(err.message); process.exit(1); });
