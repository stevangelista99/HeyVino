const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// Case-insensitive substring match against common bot/crawler/tooling UAs.
// Flagged rows are still inserted (is_bot: true), never dropped.
const BOT_RE = /bot|crawler|spider|headless|preview|curl|wget|python-requests|facebookexternalhit|slackbot/i;

const clip = (v, n) => (typeof v === 'string' ? v.slice(0, n) : null);

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { return res.status(400).json({ error: 'Bad body' }); }
  }
  body = body || {};

  const linkId = Number(body.link_id);
  if (!Number.isInteger(linkId) || linkId <= 0) {
    return res.status(400).json({ error: 'Invalid link_id' });
  }

  try {
    const { data: linkRows, error: linkErr } = await supabase
      .from('affiliate_links')
      .select('winery_id, label, network')
      .eq('id', linkId)
      .limit(1);

    if (linkErr) {
      // Lookup itself failed (DB/network issue) — swallow, never surface to visitor.
      console.error('track-click: affiliate_links lookup failed:', linkErr.message);
      return res.status(204).end();
    }
    if (!linkRows || linkRows.length === 0) {
      return res.status(404).end();
    }

    const link = linkRows[0];
    const userAgent = clip(req.headers['user-agent'] || '', 300);
    const isBot = BOT_RE.test(userAgent || '');

    const { error: insertErr } = await supabase.from('affiliate_clicks').insert({
      affiliate_link_id: linkId,
      winery_id: link.winery_id,
      label: link.label,
      network: link.network,
      source: clip(body.source, 100),
      session_id: clip(body.session_id, 100),
      referrer: clip(body.referrer, 500),
      user_agent: userAgent || null,
      is_bot: isBot,
    });

    if (insertErr) console.error('track-click: insert failed:', insertErr.message);
  } catch (err) {
    console.error('track-click: unexpected error:', err.message);
  }

  return res.status(204).end();
};
