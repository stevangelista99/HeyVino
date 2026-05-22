const fs = require('fs');
const path = require('path');

const SUPABASE_URL = 'https://lzeicurexdpludaltetf.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx6ZWljdXJleGRwbHVkYWx0ZXRmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc5NTY2NTMsImV4cCI6MjA5MzUzMjY1M30.94s0cX_FcJkUAJLT75MOo48ShZ0KZBRQUHVmdfSzf_8';
const BASE_URL = 'https://www.heyvinowine.com';

function toSlug(name) {
  return (name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function urlEntry(loc, priority = '0.8') {
  return `  <url>\n    <loc>${loc}</loc>\n    <priority>${priority}</priority>\n  </url>`;
}

async function generate() {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/promo_codes?select=winery_name&is_active=eq.true`,
    { headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${SUPABASE_ANON_KEY}` } }
  );
  if (!res.ok) throw new Error(`Supabase error: HTTP ${res.status}`);
  const data = await res.json();

  const seen = new Set();
  const slugs = [];
  for (const row of data) {
    const name = (row.winery_name || '').trim();
    if (!name) continue;
    const slug = toSlug(name);
    if (!seen.has(slug)) { seen.add(slug); slugs.push(slug); }
  }
  slugs.sort();

  const today = new Date().toISOString().split('T')[0];
  const entries = [
    urlEntry(`${BASE_URL}/`, '1.0'),
    urlEntry(`${BASE_URL}/wineries.html`, '0.9'),
    ...slugs.map(slug => urlEntry(`${BASE_URL}/winery.html?slug=${slug}`, '0.7')),
  ];

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries.join('\n')}
</urlset>`;

  const outPath = path.join(__dirname, '..', 'sitemap.xml');
  fs.writeFileSync(outPath, xml, 'utf8');
  console.log(`sitemap.xml written — ${slugs.length} winery URLs + 2 static (${today})`);
}

generate().catch(err => { console.error(err.message); process.exit(1); });
