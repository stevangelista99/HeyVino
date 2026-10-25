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
// Fetched once, filtered to active+non-expired, then split by offer_type.
// Site-Wide Deals renders in full (no cap — currently small, ~20-30 rows).
// Welcome Offers is the larger group (~80+ rows), so its static snapshot is
// capped for crawler/initial-paint purposes; live JS shows the full set.
const WELCOME_SNAPSHOT_MAX = 24;
// Comfortably above the current ~100-150 total active codes — explicit so
// this doesn't silently depend on PostgREST's own default row cap.
const FETCH_LIMIT = 1000;

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#x27;');
}

// This template shows no "Expired"/"Exp ..." text or days-left math — the
// static card snippet is just winery/offer/code — so only todayET() is
// needed here (not the full isExpired/daysLeft/formatExp set used by the
// other templates) to keep a code that's is_active=true but already past
// its expiry_date in America/New_York from being prerendered. See
// api/winery.js for the full set.
const todayET = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' }); // "YYYY-MM-DD"

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
    String(row.code || '').trim().toLowerCase() === 'no code necessary'
      ? '<p style="margin:0;font-size:0.85rem;">No code necessary</p>'
      : `<p style="margin:0;font-size:0.85rem;">Code: <code>${code}</code></p>`,
    '</article>',
  ].filter(Boolean).join('');
}

// Mirrors the .group-header / .group-header-top / .section-title /
// .section-count / .group-header-sub markup the live JS render() in
// index.html produces for the same two groups, so the page doesn't shift
// when loadCodes() replaces this prerendered block with live data.
//
// trueCount is the REAL total for this offer_type (active + non-expired,
// uncapped) — not renderRows.length, which may be a capped subset (Welcome
// Offers). Showing the true count up front means the header number doesn't
// change when live JS later renders the rest; only the card list grows.
// Hidden entirely (header included) when the true total is zero.
function groupBlockHtml(title, subtext, renderRows, trueCount) {
  if (trueCount === 0) return '';
  return [
    `<div class="group-header"><div class="group-header-top"><h2 class="section-title">${title}</h2><span class="section-count">(${trueCount})</span></div><p class="group-header-sub">${subtext}</p></div>`,
    renderRows.map(cardHtml).join('\n'),
  ].join('\n');
}

// Returns the full active+non-expired set for each offer_type, unsliced —
// callers decide how many of each to actually render. offer_type is
// exhaustively either 'sitewide' or 'welcome' in the data, so "not sitewide"
// safely covers 'welcome' and guarantees every row lands in exactly one
// group (never silently dropped from the true counts).
async function fetchActiveCodes() {
  const url = `${SUPABASE_URL}/rest/v1/promo_codes` +
    `?select=winery_name,code,discount_amount,discount_type,description,region,country,is_featured,expiry_date,offer_type` +
    `&is_active=eq.true&order=is_featured.desc,winery_name.asc&limit=${FETCH_LIMIT}`;
  const res = await fetch(url, {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
  });
  if (!res.ok) throw new Error(`Supabase fetch failed: HTTP ${res.status}`);
  const rows = await res.json();
  // A code can still be is_active=true but past its expiry_date in
  // America/New_York for up to ~24h until the next daily cleanup cron run
  // (api/cleanup.js) — don't prerender it as a card during that gap.
  const today = todayET();
  const visible = rows.filter(row => !row.expiry_date || row.expiry_date >= today);
  return {
    sitewideAll: visible.filter(row => row.offer_type === 'sitewide'),
    welcomeAll: visible.filter(row => row.offer_type !== 'sitewide'),
  };
}

async function main() {
  const indexPath = path.join(__dirname, '..', 'index.html');
  const html = fs.readFileSync(indexPath, 'utf8');

  const startIdx = html.indexOf(START);
  const endIdx = html.indexOf(END);
  if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) {
    throw new Error('PRERENDER markers not found (or malformed) in index.html — aborting without writing.');
  }

  const { sitewideAll, welcomeAll } = await fetchActiveCodes();
  if (sitewideAll.length + welcomeAll.length === 0) {
    throw new Error('No active promo codes returned — refusing to prerender an empty section.');
  }

  // Cap per group, not globally: Site-Wide Deals renders in full; only
  // Welcome Offers (the larger group) is capped for the static snapshot.
  const sitewideRender = sitewideAll;
  const welcomeRender = welcomeAll.slice(0, WELCOME_SNAPSHOT_MAX);

  const block = [
    '<section aria-label="Current wine deals">',
    groupBlockHtml('Site-Wide Deals', 'Open to everyone', sitewideRender, sitewideAll.length),
    groupBlockHtml('Welcome Offers', 'For first-time customers', welcomeRender, welcomeAll.length),
    '</section>',
  ].filter(Boolean).join('\n');

  const updated = html.slice(0, startIdx + START.length) + '\n' + block + '\n' + html.slice(endIdx);
  fs.writeFileSync(indexPath, updated);
  console.log(`Prerendered ${sitewideRender.length + welcomeRender.length} deal cards into index.html ` +
    `(Site-Wide ${sitewideRender.length}/${sitewideAll.length} true, Welcome ${welcomeRender.length}/${welcomeAll.length} true)`);
}

main().catch((err) => { console.error(err.message); process.exit(1); });
