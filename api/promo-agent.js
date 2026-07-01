const { createClient } = require('@supabase/supabase-js');
const axios = require('axios');
const crypto = require('crypto');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// ── Gmail helpers ──────────────────────────────────────────────────────────────

async function getGmailAccessToken() {
  const { data } = await axios.post('https://oauth2.googleapis.com/token', {
    client_id: process.env.GMAIL_CLIENT_ID,
    client_secret: process.env.GMAIL_CLIENT_SECRET,
    refresh_token: process.env.GMAIL_REFRESH_TOKEN,
    grant_type: 'refresh_token',
  });
  return data.access_token;
}

async function searchGmailThreads(accessToken, query) {
  const { data } = await axios.get('https://gmail.googleapis.com/gmail/v1/users/me/messages', {
    headers: { Authorization: `Bearer ${accessToken}` },
    params: { q: query, maxResults: 50 },
  });
  return data.messages || [];
}

function decodeBase64Url(str) {
  return Buffer.from(str.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf-8');
}

function extractBody(payload) {
  if (!payload) return '';

  // Prefer plain text part
  if (payload.mimeType === 'text/plain' && payload.body?.data) {
    return decodeBase64Url(payload.body.data);
  }

  // Recurse into parts
  if (payload.parts) {
    let plain = '';
    let html = '';
    for (const part of payload.parts) {
      if (part.mimeType === 'text/plain' && part.body?.data) {
        plain += decodeBase64Url(part.body.data);
      } else if (part.mimeType === 'text/html' && part.body?.data) {
        html += decodeBase64Url(part.body.data);
      } else if (part.parts) {
        plain += extractBody(part);
      }
    }
    if (plain) return plain;
    // Strip HTML tags as fallback
    return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  }

  if (payload.body?.data) return decodeBase64Url(payload.body.data);
  return '';
}

async function fetchEmailBody(accessToken, messageId) {
  const { data } = await axios.get(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
      params: { format: 'full' },
    }
  );
  const headers = data.payload?.headers || [];
  const subject = headers.find(h => h.name === 'Subject')?.value || '';
  const from = headers.find(h => h.name === 'From')?.value || '';
  const date = headers.find(h => h.name === 'Date')?.value || '';
  const body = extractBody(data.payload);
  return { subject, from, date, body };
}

// ── Claude extraction ──────────────────────────────────────────────────────────

const EXTRACTION_SYSTEM = `You are a promo code extraction assistant for HeyVino, a US wine discovery platform.
Extract redeemable promo codes from marketing emails.

Rules:
- Only extract codes that must be manually entered at checkout (not automatic/instant discounts)
- Skip offers that are Australia-only or international-only (outside the USA)
- offer_type must be "welcome" if the code contains WELCOME, SIGNUP, or SMS (case-insensitive), OR if conditions mention first order/purchase/subscriber; otherwise use "standard"
- discount_type must be exactly one of: percentage, fixed, free_shipping, other
- expiry_date must be YYYY-MM-DD or null
- Return null (as JSON: {"has_code": false}) if no valid redeemable code is found
- Return JSON only — no markdown, no explanation`;

const EXTRACTION_USER = (body, sourceDate) => `Email received: ${sourceDate}

---
${body.slice(0, 8000)}
---

Extract and return a single JSON object with these exact fields:
{
  "has_code": boolean,
  "winery_name": string | null,
  "code": string | null,
  "discount_amount": string | null,
  "discount_type": "percentage" | "fixed" | "free_shipping" | "other" | null,
  "description": string | null,
  "conditions": string | null,
  "expiry_date": "YYYY-MM-DD" | null,
  "offer_type": "welcome" | "standard" | null,
  "source_email_date": "YYYY-MM-DD" | null
}`;

async function extractWithClaude(emailBody, sourceDate) {
  const { data } = await axios.post(
    'https://api.anthropic.com/v1/messages',
    {
      model: 'claude-sonnet-4-6',
      max_tokens: 512,
      system: EXTRACTION_SYSTEM,
      messages: [{ role: 'user', content: EXTRACTION_USER(emailBody, sourceDate) }],
    },
    {
      headers: {
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
    }
  );
  const text = data.content?.[0]?.text || '';
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return { has_code: false };
  return JSON.parse(jsonMatch[0]);
}

// ── Supabase helpers ───────────────────────────────────────────────────────────

async function findWinery(wineryName) {
  if (!wineryName) return null;
  const { data } = await supabase
    .from('wineries')
    .select('id, name')
    .ilike('name', wineryName.trim())
    .limit(1);
  return data?.[0] || null;
}

async function codeExists(code, wineryId) {
  const { data } = await supabase
    .from('promo_codes')
    .select('id')
    .eq('code', code)
    .eq('winery_id', wineryId)
    .limit(1);
  return (data?.length || 0) > 0;
}

// ── SQL generation ─────────────────────────────────────────────────────────────

function buildInsertSQL(extracted, wineryId) {
  const esc = v => v == null ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`;
  return [
    'INSERT INTO promo_codes',
    '  (winery_id, code, discount_amount, discount_type, description, conditions, expiry_date, offer_type, source_email_date, is_active, is_featured)',
    'VALUES (',
    `  ${wineryId},`,
    `  ${esc(extracted.code)},`,
    `  ${esc(extracted.discount_amount)},`,
    `  ${esc(extracted.discount_type)},`,
    `  ${esc(extracted.description)},`,
    `  ${esc(extracted.conditions)},`,
    `  ${esc(extracted.expiry_date)},`,
    `  ${esc(extracted.offer_type)},`,
    `  ${esc(extracted.source_email_date)},`,
    `  true, false`,
    ');',
  ].join('\n');
}

// ── Gmail send ─────────────────────────────────────────────────────────────────

async function sendDigestEmail({ scanned, codes, flagged, sqlBlock, approvalToken, runDate, accessToken }) {
  const approveUrl = `https://www.heyvinowine.com/api/promo-approve?token=${approvalToken}`;

  const codeRows = codes.map(c =>
    `<tr>
      <td>${c.winery_name || '—'}</td>
      <td><code>${c.code}</code></td>
      <td>${c.discount_amount || '—'}</td>
      <td>${c.expiry_date || 'No expiry'}</td>
      <td>${c.offer_type || 'standard'}</td>
    </tr>`
  ).join('');

  const flaggedRows = flagged.map(f =>
    `<li>${f.winery_name} — code: <code>${f.code}</code></li>`
  ).join('');

  const htmlBody = `
<!DOCTYPE html><html><body style="font-family:sans-serif;color:#222;max-width:700px;margin:auto">
<h2>HeyVino Promo Agent — ${runDate}</h2>
<p><strong>${scanned}</strong> emails scanned &nbsp;|&nbsp;
   <strong>${codes.length}</strong> codes found &nbsp;|&nbsp;
   <strong>${flagged.length}</strong> flagged for review</p>

${codes.length > 0 ? `
<h3>Codes ready to insert</h3>
<table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;width:100%">
  <thead><tr><th>Winery</th><th>Code</th><th>Discount</th><th>Expiry</th><th>Type</th></tr></thead>
  <tbody>${codeRows}</tbody>
</table>` : '<p>No codes to insert.</p>'}

${flagged.length > 0 ? `
<h3>Wineries not in DB (manual review)</h3>
<ul>${flaggedRows}</ul>` : ''}

<h3>Approve &amp; run SQL</h3>
<p>
  <a href="${approveUrl}" style="background:#7c3aed;color:#fff;padding:12px 24px;text-decoration:none;border-radius:6px;font-size:15px">
    ✓ Approve &amp; Execute SQL
  </a>
</p>

<h3>Generated SQL</h3>
<pre style="background:#f4f4f4;padding:16px;border-radius:4px;font-size:12px;overflow-x:auto">${sqlBlock.replace(/</g, '&lt;')}</pre>

</body></html>`;

  const subject = `HeyVino Promo Agent — ${scanned} scanned, ${codes.length} codes, ${flagged.length} flagged [${runDate}]`;

  // Build a minimal RFC 2822 message and base64url-encode it for the Gmail API
  const rfc2822 = [
    `From: HeyVinoPromos@gmail.com`,
    `To: HeyVinoMarketing@gmail.com`,
    `Subject: ${subject}`,
    `MIME-Version: 1.0`,
    `Content-Type: text/html; charset=UTF-8`,
    ``,
    htmlBody,
  ].join('\r\n');

  const encoded = Buffer.from(rfc2822)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  await axios.post(
    'https://gmail.googleapis.com/gmail/v1/users/me/messages/send',
    { raw: encoded },
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
}

// ── Main handler ───────────────────────────────────────────────────────────────

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Auth check
  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.replace(/^Bearer\s+/i, '');
  if (!token || token !== process.env.AGENT_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);

  const fmt = d => `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
  const runDate = yesterday.toISOString().split('T')[0];
  const gmailQuery = `after:${fmt(yesterday)} before:${fmt(today)} (promo OR discount OR code OR "% off" OR welcome OR offer OR save OR shipping)`;

  let accessToken;
  try {
    accessToken = await getGmailAccessToken();
  } catch (err) {
    console.error('Gmail auth failed:', err.message);
    return res.status(500).json({ error: 'Gmail auth failed', detail: err.message });
  }

  let messages;
  try {
    messages = await searchGmailThreads(accessToken, gmailQuery);
  } catch (err) {
    console.error('Gmail search failed:', err.message);
    return res.status(500).json({ error: 'Gmail search failed', detail: err.message });
  }

  console.log(`Found ${messages.length} messages for ${runDate}`);

  const insertStatements = [];
  const codesForDigest = [];
  const flaggedWineries = [];
  let emailsScanned = 0;

  for (const msg of messages) {
    let email;
    try {
      email = await fetchEmailBody(accessToken, msg.id);
      emailsScanned++;
    } catch (err) {
      console.error(`Failed to fetch message ${msg.id}:`, err.message);
      continue;
    }

    let extracted;
    try {
      extracted = await extractWithClaude(email.body, runDate);
    } catch (err) {
      console.error(`Claude extraction failed for message ${msg.id}:`, err.message);
      continue;
    }

    if (!extracted?.has_code || !extracted.code) continue;

    extracted.source_email_date = extracted.source_email_date || runDate;

    // Look up winery
    let winery;
    try {
      winery = await findWinery(extracted.winery_name);
    } catch (err) {
      console.error(`Winery lookup failed for "${extracted.winery_name}":`, err.message);
      continue;
    }

    if (!winery) {
      flaggedWineries.push({ winery_name: extracted.winery_name, code: extracted.code });
      console.log(`Flagged (winery not in DB): ${extracted.winery_name}`);
      continue;
    }

    // Duplicate check
    let duplicate;
    try {
      duplicate = await codeExists(extracted.code, winery.id);
    } catch (err) {
      console.error(`Duplicate check failed for code ${extracted.code}:`, err.message);
      continue;
    }

    if (duplicate) {
      console.log(`Skipping duplicate code: ${extracted.code} for winery ${winery.id}`);
      continue;
    }

    insertStatements.push(buildInsertSQL(extracted, winery.id));
    codesForDigest.push({ ...extracted, winery_name: winery.name });
  }

  // Append deactivation sweep
  const deactivation = `UPDATE promo_codes SET is_active = false WHERE expiry_date < CURRENT_DATE AND is_active = true;`;
  const sqlBlock = [...insertStatements, deactivation].join('\n\n');

  const approvalToken = crypto.randomUUID();

  // Persist run record
  try {
    const { error } = await supabase.from('promo_agent_runs').insert({
      run_date: runDate,
      emails_scanned: emailsScanned,
      codes_found: codesForDigest.length,
      codes_skipped_new_winery: flaggedWineries.length,
      sql_generated: sqlBlock,
      approval_token: approvalToken,
      approved: false,
    });
    if (error) console.error('Failed to save run record:', error.message);
  } catch (err) {
    console.error('Failed to save run record:', err.message);
  }

  // Send digest email
  try {
    await sendDigestEmail({
      scanned: emailsScanned,
      codes: codesForDigest,
      flagged: flaggedWineries,
      sqlBlock,
      approvalToken,
      runDate,
      accessToken,
    });
  } catch (err) {
    console.error('Failed to send digest email:', err.message);
  }

  return res.status(200).json({
    run_date: runDate,
    emails_scanned: emailsScanned,
    codes_found: codesForDigest.length,
    codes_skipped_new_winery: flaggedWineries.length,
    approval_token: approvalToken,
    sql_lines: insertStatements.length,
  });
};
