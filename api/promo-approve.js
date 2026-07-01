const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

function html(title, bodyContent, isError = false) {
  const colour = isError ? '#dc2626' : '#16a34a';
  const icon = isError ? '⚠️' : '✅';
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title} — HeyVino</title>
  <style>
    body { font-family: -apple-system, sans-serif; display: flex; align-items: center;
           justify-content: center; min-height: 100vh; margin: 0; background: #f9fafb; }
    .card { background: #fff; border-radius: 12px; padding: 48px 40px; max-width: 480px;
            width: 100%; box-shadow: 0 4px 24px rgba(0,0,0,.08); text-align: center; }
    .icon { font-size: 48px; margin-bottom: 16px; }
    h1 { margin: 0 0 12px; font-size: 22px; color: ${colour}; }
    p { color: #6b7280; margin: 0; line-height: 1.6; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">${icon}</div>
    <h1>${title}</h1>
    ${bodyContent}
  </div>
</body>
</html>`;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  const { token } = req.query;

  if (!token) {
    res.setHeader('Content-Type', 'text/html');
    return res.status(400).send(html(
      'Missing token',
      '<p>No approval token was provided in the URL.</p>',
      true
    ));
  }

  // Look up the run record
  let run;
  try {
    const { data, error } = await supabase
      .from('promo_agent_runs')
      .select('id, approved, sql_generated, run_date, codes_found')
      .eq('approval_token', token)
      .single();

    if (error || !data) {
      res.setHeader('Content-Type', 'text/html');
      return res.status(404).send(html(
        'Invalid or already used approval link',
        '<p>This link is not recognised. It may have already been used or the token is incorrect.</p>',
        true
      ));
    }
    run = data;
  } catch (err) {
    console.error('DB lookup failed:', err.message);
    res.setHeader('Content-Type', 'text/html');
    return res.status(500).send(html(
      'Database error',
      `<p>Could not look up the approval token. Please try again or contact support.</p><p><small>${err.message}</small></p>`,
      true
    ));
  }

  if (run.approved) {
    res.setHeader('Content-Type', 'text/html');
    return res.status(200).send(html(
      'Invalid or already used approval link',
      `<p>This approval link for <strong>${run.run_date}</strong> has already been used.</p>`,
      true
    ));
  }

  // Split the stored SQL block into individual statements and execute each one.
  // Statements were joined with '\n\n' in promo-agent.js; each ends with ';'.
  // Requires a helper function in Supabase (create once):
  //   CREATE OR REPLACE FUNCTION exec_sql(sql_query text) RETURNS void
  //   LANGUAGE plpgsql SECURITY DEFINER AS $$ BEGIN EXECUTE sql_query; END; $$;
  const statements = (run.sql_generated || '')
    .split(/\n\n/)
    .map(s => s.trim())
    .filter(s => s.length > 0);

  const errors = [];
  let executed = 0;

  for (const stmt of statements) {
    try {
      const { error } = await supabase.rpc('exec_sql', { sql_query: stmt });
      if (error) {
        console.error('Statement failed:', stmt.slice(0, 120), error.message);
        errors.push(error.message);
      } else {
        executed++;
      }
    } catch (err) {
      console.error('RPC error:', err.message);
      errors.push(err.message);
    }
  }

  if (errors.length > 0 && executed === 0) {
    res.setHeader('Content-Type', 'text/html');
    return res.status(500).send(html(
      'SQL execution failed',
      `<p>None of the statements could be executed. Check the Vercel logs for details.</p>
       <p><small>${errors[0]}</small></p>`,
      true
    ));
  }

  // Mark approved regardless of partial failures so the link can't be replayed
  try {
    const { error } = await supabase
      .from('promo_agent_runs')
      .update({ approved: true })
      .eq('id', run.id);

    if (error) console.error('Failed to mark run as approved:', error.message);
  } catch (err) {
    console.error('Failed to mark run as approved:', err.message);
  }

  const partialWarning = errors.length > 0
    ? `<p style="color:#b45309;font-size:14px;margin-top:12px">⚠️ ${errors.length} statement(s) failed — check Vercel logs.</p>`
    : '';

  res.setHeader('Content-Type', 'text/html');
  return res.status(200).send(html(
    'Promo codes approved and written to database. Deactivation sweep complete.',
    `<p>Run date: <strong>${run.run_date}</strong><br>
     Statements executed: <strong>${executed}</strong> of <strong>${statements.length}</strong></p>
     ${partialWarning}`
  ));
};
