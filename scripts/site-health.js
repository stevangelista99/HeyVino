// Tier 1 site-health monitor — internal integrity checks only. Compares the
// Supabase database against what's actually rendered/deployed on the live
// site, and catches broken/mismatched winery links. Does NOT make any
// outbound requests to external winery websites (that's a separate future
// script) and never writes to Supabase or any template file — read-only.
//
// Run manually:
//   node scripts/site-health.js
//
// Writes/updates site-health-report.json in the repo root (history of the
// last 30 runs, committed to git — that file IS the history).

const fs = require('fs');
const path = require('path');

const SUPABASE_URL = 'https://lzeicurexdpludaltetf.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx6ZWljdXJleGRwbHVkYWx0ZXRmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc5NTY2NTMsImV4cCI6MjA5MzUzMjY1M30.94s0cX_FcJkUAJLT75MOo48ShZ0KZBRQUHVmdfSzf_8';
const BASE_URL = 'https://www.heyvinowine.com';
const REPO_ROOT = path.join(__dirname, '..');
const REPORT_PATH = path.join(REPO_ROOT, 'site-health-report.json');
const MAX_HISTORY_RUNS = 30;
const LIVENESS_CONCURRENCY = 20;

// Must match MAX_CARDS in scripts/prerender-homepage.js — the prerender script's
// own selection limit. If that constant ever changes, update this too.
const PRERENDER_MAX_CARDS = 24;

const supaHeaders = { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` };

// ---------------------------------------------------------------- helpers --

function decodeEntities(str) {
  return String(str || '')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&apos;/g, "'");
}

// Strip accents, decode entities, lowercase, collapse whitespace — so
// "St. Supery Estate" and "St. Supéry Estate" compare equal.
function normalize(str) {
  return decodeEntities(str)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

async function supabaseGet(queryPath) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${queryPath}`, { headers: supaHeaders });
  if (!res.ok) throw new Error(`Supabase error: HTTP ${res.status} for ${queryPath}`);
  return res.json();
}

async function fetchPage(url) {
  try {
    const res = await fetch(url);
    const text = res.status === 200 ? await res.text() : '';
    return { status: res.status, text };
  } catch (err) {
    return { status: 0, text: '', error: err.message };
  }
}

// Bounded-concurrency map — runs `fn` over `items` with at most `limit` in flight.
async function mapConcurrent(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

// ------------------------------------------------------------------ checks --

// CHECK 1 — Directory completeness: wineries.html links vs active DB rows.
async function checkDirectoryCompleteness(activeWineries) {
  const res = await fetch(`${BASE_URL}/wineries.html`);
  if (!res.ok) throw new Error(`Failed to fetch ${BASE_URL}/wineries.html: HTTP ${res.status}`);
  const html = await res.text();

  const pageSlugs = new Set();
  for (const m of html.matchAll(/winery\.html\?slug=([a-z0-9-]+)/gi)) pageSlugs.add(m[1].toLowerCase());

  const dbSlugs = new Set(activeWineries.map(w => (w.slug || '').toLowerCase()).filter(Boolean));

  const orphaned = [...pageSlugs].filter(s => !dbSlugs.has(s));
  const missing = [...dbSlugs].filter(s => !pageSlugs.has(s));

  const issues = [
    ...orphaned.map(slug => ({ key: `orphan:${slug}`, detail: `"${slug}" appears on /wineries.html but has no active DB row` })),
    ...missing.map(slug => ({ key: `missing:${slug}`, detail: `"${slug}" is an active DB row but has no link on /wineries.html` })),
  ];

  return { issues, counts: { orphaned: orphaned.length, missing: missing.length, pageSlugTotal: pageSlugs.size, dbSlugTotal: dbSlugs.size } };
}

// CHECK 2 + 3 — Winery page liveness and correctness (one fetch pass covers both).
async function checkLivenessAndCorrectness(activeWineries) {
  const livenessIssues = [];
  const correctnessIssues = [];

  await mapConcurrent(activeWineries, LIVENESS_CONCURRENCY, async (w) => {
    const url = `${BASE_URL}/winery.html?slug=${encodeURIComponent(w.slug)}`;
    const { status, text, error } = await fetchPage(url);

    if (status !== 200 && status !== 304) {
      livenessIssues.push({
        key: `livecheck:${w.slug}`,
        detail: `"${w.slug}" (${w.name}) returned HTTP ${status}${error ? ' — ' + error : ''}`,
      });
      return; // can't check correctness without a body
    }

    if (status === 200) {
      const normPage = normalize(text);
      const normName = normalize(w.name);
      if (normName && !normPage.includes(normName)) {
        correctnessIssues.push({
          key: `namecheck:${w.slug}`,
          detail: `"${w.slug}" returned 200 but the page does not contain the winery name "${w.name}" — possible wrong-winery render or fallback page`,
        });
      }
    }
  });

  return {
    liveness: { issues: livenessIssues, counts: { non200: livenessIssues.length, totalChecked: activeWineries.length } },
    correctness: { issues: correctnessIssues, counts: { mismatched: correctnessIssues.length, totalChecked: activeWineries.length } },
  };
}

// CHECK 4 — Homepage prerender staleness (highest value check).
async function checkPrerenderStaleness() {
  const indexPath = path.join(REPO_ROOT, 'index.html');
  const html = fs.readFileSync(indexPath, 'utf8');

  const START = '<!-- PRERENDER:START -->';
  const END = '<!-- PRERENDER:END -->';
  const startIdx = html.indexOf(START);
  const endIdx = html.indexOf(END);
  if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) {
    throw new Error('PRERENDER markers not found (or malformed) in index.html');
  }
  const block = html.slice(startIdx + START.length, endIdx);

  // Identity key is (winery_name + code), not code alone — many wineries
  // reuse generic codes like "WELCOME10"/"WELCOME20", so code-only comparison
  // would silently collapse distinct rows and miss real drift.
  const cardKey = (winery, code) => `${normalize(winery)}|||${code}`;

  const currentCards = [];
  for (const m of block.matchAll(/<article class="prerender-card"[^>]*>([\s\S]*?)<\/article>/g)) {
    const articleHtml = m[1];
    const nameMatch = articleHtml.match(/<h3[^>]*>([^<]*)<\/h3>/);
    const codeMatch = articleHtml.match(/Code:\s*<code>([^<]*)<\/code>/);
    const winery = nameMatch ? decodeEntities(nameMatch[1]) : '';
    const code = codeMatch ? decodeEntities(codeMatch[1]) : '';
    currentCards.push({ winery, code, key: cardKey(winery, code) });
  }
  const currentKeys = new Set(currentCards.map(c => c.key));
  const currentByKey = new Map(currentCards.map(c => [c.key, c]));

  // Exact selection logic from scripts/prerender-homepage.js: fetchActiveCodes().
  const expectedRows = await supabaseGet(
    `promo_codes?select=winery_name,code,discount_amount,discount_type,description,region,country,is_featured` +
    `&is_active=eq.true&order=is_featured.desc,winery_name.asc&limit=${PRERENDER_MAX_CARDS}`
  );
  const expectedRowsKeyed = expectedRows.map(r => ({ ...r, key: cardKey(r.winery_name, r.code) }));
  const expectedKeys = new Set(expectedRowsKeyed.map(r => r.key));
  const expectedByKey = new Map(expectedRowsKeyed.map(r => [r.key, r]));

  const extra = [...currentKeys].filter(k => !expectedKeys.has(k));
  const missing = [...expectedKeys].filter(k => !currentKeys.has(k));

  const issues = [
    ...extra.map(k => {
      const c = currentByKey.get(k);
      return { key: `prerender-extra:${k}`, detail: `Prerendered card "${c.code}" (${c.winery}) is baked into index.html but is no longer in the live active-codes selection` };
    }),
    ...missing.map(k => {
      const r = expectedByKey.get(k);
      return { key: `prerender-missing:${k}`, detail: `"${r.code}" (${r.winery_name}) should be in the prerendered grid per current DB state but is not baked into index.html` };
    }),
  ];

  return {
    issues,
    counts: { extra: extra.length, missing: missing.length, currentTotal: currentKeys.size, expectedTotal: expectedKeys.size },
    needsRerun: issues.length > 0,
  };
}

// CHECK 5 — Sitemap vs. live active wineries.
async function checkSitemapVsLive(activeWineries) {
  const sitemapPath = path.join(REPO_ROOT, 'sitemap.xml');
  if (!fs.existsSync(sitemapPath)) throw new Error('sitemap.xml not found at repo root');
  const xml = fs.readFileSync(sitemapPath, 'utf8');

  const sitemapSlugs = new Set();
  for (const m of xml.matchAll(/winery\.html\?slug=([a-z0-9-]+)/gi)) sitemapSlugs.add(m[1].toLowerCase());

  const dbSlugs = new Set(activeWineries.map(w => (w.slug || '').toLowerCase()).filter(Boolean));
  const bySlug = new Map(activeWineries.map(w => [(w.slug || '').toLowerCase(), w]));

  // For annotation only: replicate generate-sitemap.js's "indexable" filter
  // (has an active code OR a written description) so a "missing from sitemap"
  // entry can be marked expected/benign vs. genuinely wrong.
  const [wineriesFull, codes] = await Promise.all([
    supabaseGet('wineries?select=name,slug,description&is_active=eq.true'),
    supabaseGet('promo_codes?select=winery_name&is_active=eq.true'),
  ]);
  const hasCode = new Set(codes.map(r => (r.winery_name || '').toLowerCase()).filter(Boolean));
  const descBySlug = new Map(wineriesFull.map(w => [(w.slug || '').toLowerCase(), { name: w.name, hasDesc: !!(w.description && w.description.trim()) }]));

  const sitemapOrphans = [...sitemapSlugs].filter(s => !dbSlugs.has(s));
  const missingFromSitemap = [...dbSlugs].filter(s => !sitemapSlugs.has(s));

  const issues = [
    ...sitemapOrphans.map(slug => ({ key: `sitemap-orphan:${slug}`, detail: `Sitemap links "${slug}" but it is not an active DB row` })),
    ...missingFromSitemap.map(slug => {
      const meta = descBySlug.get(slug);
      const info = bySlug.get(slug);
      const expected = meta && !hasCode.has((meta.name || '').toLowerCase()) && !meta.hasDesc;
      return {
        key: `sitemap-missing:${slug}`,
        detail: `"${slug}" (${info ? info.name : slug}) is active but not in sitemap.xml` +
          (expected ? ' — expected: no active code and no description, matches generate-sitemap.js\'s indexable filter' : ' — unexpected: has a code or description, should be indexable'),
        expected: !!expected,
      };
    }),
  ];

  return { issues, counts: { sitemapOrphans: sitemapOrphans.length, missingFromSitemap: missingFromSitemap.length } };
}

// CHECK 6 — Template parity: hardcoded one-off special cases across the
// three independent card-rendering templates.
function checkTemplateParity() {
  const files = ['index.html', 'api/winery.js', 'api/wineries.js'];
  const patterns = [
    // field === 'literal'  /  field == "literal"
    /\b(winery_name|code|winery|slug)\s*(===|==)\s*(['"])(?:(?!\3).)+\3/i,
    // 'literal' === field
    /(['"])(?:(?!\1).){1,60}\1\s*(===|==)\s*[\w.]*\b(winery_name|code|winery|slug)\b/i,
    // field.toLowerCase() === 'literal'  (e.g. name-matching hacks)
    /\b(winery_name|code|winery|slug)\b[^\n;]*\.toLowerCase\(\)\s*(===|==)\s*['"]/i,
    // field.includes('literal') / startsWith / endsWith
    /\b(winery_name|code|winery|slug)\b[^\n;]*\.(includes|startsWith|endsWith)\(\s*['"][^'"]+['"]/i,
  ];

  const issues = [];
  for (const relPath of files) {
    const fullPath = path.join(REPO_ROOT, relPath);
    if (!fs.existsSync(fullPath)) continue;
    const lines = fs.readFileSync(fullPath, 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (patterns.some(re => re.test(line))) {
        issues.push({
          key: `specialcase:${relPath}:${i + 1}`,
          detail: `${relPath}:${i + 1} — ${line.trim().slice(0, 160)}`,
        });
      }
    });
  }

  return { issues, counts: { specialCases: issues.length } };
}

// ------------------------------------------------------------------- main --

function loadHistory() {
  if (!fs.existsSync(REPORT_PATH)) return { runs: [] };
  try {
    const parsed = JSON.parse(fs.readFileSync(REPORT_PATH, 'utf8'));
    return Array.isArray(parsed.runs) ? parsed : { runs: [] };
  } catch {
    return { runs: [] };
  }
}

function statusFor(issues) {
  return issues.length === 0 ? 'PASS' : 'FAIL';
}

function printSummaryTable(checkResults) {
  const rows = Object.entries(checkResults).map(([name, r]) => ({
    name,
    status: r.error ? 'ERROR' : statusFor(r.issues),
    count: r.error ? '-' : String(r.issues.length),
  }));
  const nameWidth = Math.max(...rows.map(r => r.name.length), 'CHECK'.length);
  console.log('\n' + 'CHECK'.padEnd(nameWidth) + '  STATUS  ISSUES');
  console.log('-'.repeat(nameWidth + 18));
  for (const r of rows) {
    console.log(r.name.padEnd(nameWidth) + '  ' + r.status.padEnd(6) + '  ' + r.count);
  }
  console.log('');
}

function printDiffSection(checkName, currentIssues, previousIssues) {
  const prevKeys = new Set((previousIssues || []).map(i => i.key));
  const newIssues = currentIssues.filter(i => !prevKeys.has(i.key));
  const ongoingIssues = currentIssues.filter(i => prevKeys.has(i.key));

  if (newIssues.length === 0 && ongoingIssues.length === 0) return;

  console.log(`\n=== ${checkName} ===`);
  if (newIssues.length > 0) {
    console.log(`  NEW (${newIssues.length}):`);
    newIssues.forEach(i => console.log(`    - ${i.detail}`));
  }
  if (ongoingIssues.length > 0) {
    console.log(`  ONGOING (${ongoingIssues.length}, already reported last run):`);
    ongoingIssues.forEach(i => console.log(`    - ${i.detail}`));
  }
}

async function main() {
  console.log(`Site health check — ${new Date().toISOString()}\n`);

  let activeWineries;
  try {
    activeWineries = await supabaseGet('wineries?select=id,name,slug&is_active=eq.true');
    if (!Array.isArray(activeWineries) || activeWineries.length === 0) {
      throw new Error('Supabase returned zero active wineries — refusing to proceed (likely a query or connectivity problem, not a real empty DB)');
    }
  } catch (err) {
    console.error(`FATAL: could not load active wineries from Supabase — ${err.message}`);
    process.exit(1);
  }

  const checkResults = {};

  const runCheck = async (name, fn) => {
    try {
      checkResults[name] = await fn();
    } catch (err) {
      checkResults[name] = { issues: [], error: err.message };
    }
  };

  await runCheck('directory_completeness', () => checkDirectoryCompleteness(activeWineries));

  let livenessAndCorrectness;
  try {
    livenessAndCorrectness = await checkLivenessAndCorrectness(activeWineries);
    checkResults.winery_page_liveness = livenessAndCorrectness.liveness;
    checkResults.winery_page_correctness = livenessAndCorrectness.correctness;
  } catch (err) {
    checkResults.winery_page_liveness = { issues: [], error: err.message };
    checkResults.winery_page_correctness = { issues: [], error: err.message };
  }

  await runCheck('homepage_prerender_staleness', () => checkPrerenderStaleness());
  await runCheck('sitemap_vs_live', () => checkSitemapVsLive(activeWineries));
  await runCheck('template_parity', async () => checkTemplateParity());

  // ---- console output ----
  printSummaryTable(checkResults);

  const history = loadHistory();
  const previousRun = history.runs[history.runs.length - 1];

  for (const [name, result] of Object.entries(checkResults)) {
    if (result.error) {
      console.log(`\n=== ${name} ===\n  ERROR: ${result.error}`);
      continue;
    }
    const previousIssues = previousRun && previousRun.checks[name] ? previousRun.checks[name].issues : [];
    printDiffSection(name, result.issues, previousIssues);
  }

  // ---- persist history ----
  const entry = {
    timestamp: new Date().toISOString(),
    checks: Object.fromEntries(Object.entries(checkResults).map(([name, r]) => [
      name,
      {
        status: r.error ? 'ERROR' : statusFor(r.issues),
        error: r.error || undefined,
        counts: r.counts || undefined,
        issues: r.issues || [],
      },
    ])),
  };

  history.runs.push(entry);
  if (history.runs.length > MAX_HISTORY_RUNS) history.runs = history.runs.slice(-MAX_HISTORY_RUNS);
  fs.writeFileSync(REPORT_PATH, JSON.stringify(history, null, 2) + '\n', 'utf8');
  console.log(`\nReport written to ${path.relative(REPO_ROOT, REPORT_PATH)} (${history.runs.length} run(s) retained)`);

  const anyFail = Object.values(checkResults).some(r => r.error || r.issues.length > 0);
  process.exit(anyFail ? 1 : 0);
}

main().catch(err => {
  console.error(`FATAL: ${err.message}`);
  process.exit(1);
});
