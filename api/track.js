const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

const ALLOWED_EVENTS = new Set(['code_copy', 'visit_site']);
const clip = (v, n) => (typeof v === 'string' ? v.slice(0, n) : null);

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // navigator.sendBeacon posts as text/plain, so req.body may arrive as a raw string.
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { return res.status(400).json({ error: 'Bad body' }); }
  }
  if (!body || !ALLOWED_EVENTS.has(body.event)) {
    return res.status(400).json({ error: 'Bad event' });
  }

  const { error } = await supabase.from('click_events').insert({
    event_type: body.event,
    winery: clip(body.winery, 120),
    code: clip(body.code, 60),
    page: clip(body.page, 200),
  });
  if (error) {
    console.error('track insert failed:', error.message);
    return res.status(500).json({ error: 'Insert failed' });
  }
  return res.status(204).end();
};
