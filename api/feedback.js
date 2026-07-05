const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { return res.status(400).json({ error: 'Bad body' }); }
  }
  if (!body || !UUID_RE.test(String(body.code_id || '')) || !['up', 'down'].includes(body.vote)) {
    return res.status(400).json({ error: 'Bad request' });
  }

  const { error } = await supabase.from('code_feedback').insert({
    code_id: body.code_id,
    vote: body.vote,
  });
  if (error) {
    console.error('feedback insert failed:', error.message);
    return res.status(500).json({ error: 'Insert failed' });
  }
  return res.status(204).end();
};
