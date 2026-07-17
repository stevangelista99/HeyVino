const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// Allowed reporting windows (days). 'all' disables the date filter entirely.
const ALLOWED_WINDOWS = ['30', '90', '180', '365', 'all'];

function summarizeFeedback(rows) {
  const byCode = new Map();
  for (const r of rows || []) {
    const p = r.promo_codes || {};
    const key = (p.winery_name || '?') + '::' + (p.code || r.code_id);
    if (!byCode.has(key)) {
      byCode.set(key, { winery: p.winery_name || 'Unknown', code: p.code || '(deleted code)', ups: 0, downs: 0, last: null });
    }
    const e = byCode.get(key);
    if (r.vote === 'up') e.ups++;
    else if (r.vote === 'down') e.downs++;
    if (!e.last || r.created_at > e.last) e.last = r.created_at;
  }
  return [...byCode.values()].sort((a, b) => (b.downs - a.downs) || ((b.ups + b.downs) - (a.ups + a.downs)));
}

function summarizeClicks(rows) {
  const byWinery = new Map();
  let copies = 0, visits = 0;
  for (const r of rows || []) {
    if (r.event_type === 'code_copy') copies++;
    else if (r.event_type === 'visit_site') visits++;
    const key = r.winery || 'Unknown';
    if (!byWinery.has(key)) byWinery.set(key, { winery: key, copies: 0, visits: 0 });
    const e = byWinery.get(key);
    if (r.event_type === 'code_copy') e.copies++;
    else e.visits++;
  }
  return { copies, visits, byWinery: [...byWinery.values()].sort((a, b) => (b.copies + b.visits) - (a.copies + a.visits)) };
}

function summarizeCopiesByCode(rows) {
  const byCode = new Map();
  for (const r of rows || []) {
    if (r.event_type !== 'code_copy') continue;
    const key = (r.winery || 'Unknown') + '::' + (r.code || '?');
    if (!byCode.has(key)) byCode.set(key, { winery: r.winery || 'Unknown', code: r.code || '(unknown)', copies: 0, last: null });
    const e = byCode.get(key);
    e.copies++;
    if (!e.last || r.created_at > e.last) e.last = r.created_at;
  }
  return [...byCode.values()].sort((a, b) => b.copies - a.copies);
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const expected = process.env.DASHBOARD_KEY;
  if (!expected) return res.status(503).json({ error: 'DASHBOARD_KEY env var not configured in Vercel' });
  if ((req.query?.key || '') !== expected) return res.status(401).json({ error: 'Unauthorized' });

  const windowParam = String(req.query?.days || '30');
  const windowDays = ALLOWED_WINDOWS.includes(windowParam) ? windowParam : '30';

  let fbQuery = supabase
    .from('code_feedback')
    .select('vote, created_at, code_id, promo_codes(winery_name, code)')
    .order('created_at', { ascending: false })
    .limit(2000);
  let clickQuery = supabase
    .from('click_events')
    .select('event_type, winery, code, created_at')
    .order('created_at', { ascending: false })
    .limit(5000);

  if (windowDays !== 'all') {
    const since = new Date(Date.now() - parseInt(windowDays, 10) * 24 * 60 * 60 * 1000).toISOString();
    fbQuery = fbQuery.gte('created_at', since);
    clickQuery = clickQuery.gte('created_at', since);
  }

  const [fb, clicks] = await Promise.all([fbQuery, clickQuery]);

  if (fb.error) return res.status(500).json({ error: 'feedback query failed: ' + fb.error.message });
  if (clicks.error) return res.status(500).json({ error: 'clicks query failed: ' + clicks.error.message });

  const feedback = summarizeFeedback(fb.data);
  const clickSummary = summarizeClicks(clicks.data);

  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({
    window_days: windowDays,
    generated_at: new Date().toISOString(),
    totals: {
      votes: (fb.data || []).length,
      code_copies: clickSummary.copies,
      site_visits: clickSummary.visits,
    },
    codes_with_downvotes: feedback.filter(f => f.downs > 0),
    feedback_by_code: feedback,
    clicks_by_winery: clickSummary.byWinery,
    copies_by_code: summarizeCopiesByCode(clicks.data),
    recent_feedback: (fb.data || []).slice(0, 50).map(r => ({
      vote: r.vote,
      created_at: r.created_at,
      winery: r.promo_codes?.winery_name || 'Unknown',
      code: r.promo_codes?.code || '',
    })),
  });
};

module.exports._internals = { summarizeFeedback, summarizeClicks, summarizeCopiesByCode };
