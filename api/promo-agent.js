const { createClient } = require('@supabase/supabase-js');
const { google } = require('googleapis');
const Anthropic = require('@anthropic-ai/sdk');
const crypto = require('crypto');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── Gmail client ───────────────────────────────────────────────────────────────

function makeGmailClient() {
  const auth = new google.auth.OAuth2(
    process.env.GMAIL_CLIENT_ID,
    process.env.GMAIL_CLIENT_SECRET
  );
  auth.setCredentials({ refresh_token: process.env.GMAIL_REFRESH_TOKEN });
  return google.gmail({ version: 'v1', auth });
}

async function searchGmailMessages(gmail, query) {
  // Paginate: heavy promo days (holidays) can exceed a single 50-result page.
  const all = [];
  let pageToken;
  do {
    const res = await gmail.users.messages.list({
      userId: 'me',
      q: query,
      maxResults: 50,
      pageToken,
    });
    all.push(...(res.data.messages || []));
    pageToken = res.data.nextPageToken;
  } while (pageToken && all.length < 150);
  return all;
}

function decodeBase64Url(str) {
  return Buffer.from(str.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf-8');
}

function decodeEntities(s) {
  return String(s || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&#0?39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\u00ad|\u200b|͏/g, ' ');
}

function extractHiddenText(html) {
  if (!html) return '';
  // Marketing emails hide preview/preheader text in display:none divs/spans
  // (shown only in the inbox preview line). Codes sometimes appear ONLY here,
  // and templates often contain more than one hidden block — capture them all.
  const blocks = [...html.matchAll(/<(div|span)[^>]*style=["'][^"']*display\s*:\s*none[^"']*["'][^>]*>([\s\S]*?)<\/\1>/gi)]
    .map(m => decodeEntities(m[2].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  return blocks.join(' ').slice(0, 1200);
}

function extractImageAltText(html) {
  if (!html) return '';
  const alts = [...html.matchAll(/<img[^>]*alt=["']([^"']+)["']/gi)]
    .map(m => decodeEntities(m[1]).trim())
    .filter(Boolean);
  return alts.join(' | ').slice(0, 800);
}

function extractLinkCodes(html) {
  if (!html) return '';
  // Codes are sometimes only present as URL params in CTA links,
  // e.g. href="https://winery.com/shop?promo=SUMMER25".
  const found = new Set();
  for (const m of html.matchAll(/[?&](?:promo(?:_?code)?|coupon(?:_?code)?|code|discount)=([A-Za-z0-9_-]{3,24})(?=[&"'\s>]|$)/gi)) {
    found.add(m[1]);
    if (found.size >= 10) break;
  }
  return found.size ? 'Possible codes found in links: ' + [...found].join(', ') : '';
}

function extractBody(payload) {
  if (!payload) return '';

  if (payload.mimeType === 'text/plain' && payload.body?.data) {
    return decodeBase64Url(payload.body.data);
  }

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

    // Hidden preheader text, image alt text, and link-embedded codes can carry
    // the actual offer/code even when the visible plaintext is just nav links
    // or the email is image-only. Placed FIRST so downstream length slicing
    // can never truncate them away.
    const extras = [extractHiddenText(html), extractImageAltText(html), extractLinkCodes(html)]
      .filter(Boolean)
      .join('\n');
    const visible = plain
      ? plain
      : decodeEntities(html.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

    return extras
      ? `[Hidden preview/image/link text]\n${extras}\n\n[Visible body]\n${visible}`
      : visible;
  }

  if (payload.body?.data) return decodeBase64Url(payload.body.data);
  return '';
}

async function fetchEmailBody(gmail, messageId) {
  const res = await gmail.users.messages.get({
    userId: 'me',
    id: messageId,
    format: 'full',
  });
  const headers = res.data.payload?.headers || [];
  const subject = headers.find(h => h.name === 'Subject')?.value || '';
  const from = headers.find(h => h.name === 'From')?.value || '';
  const date = headers.find(h => h.name === 'Date')?.value || '';
  const body = extractBody(res.data.payload);
  return { subject, from, date, body };
}

// ── Claude extraction ──────────────────────────────────────────────────────────

const EXTRACTION_SYSTEM = `You are a promo code extraction assistant for HeyVino, a US wine discovery platform.
Extract ALL redeemable promo codes from marketing emails — an email may contain zero, one, or several distinct codes.

Rules:
- Only extract codes that must be manually entered at checkout (not automatic/instant discounts)
- Skip offers that are Australia-only or international-only (outside the USA)
- The email body may begin with a "[Hidden preview/image/link text]" section — this contains hidden inbox-preview text, image alt text, and codes found inside link URLs from the original email. Codes sometimes appear ONLY there. Check it carefully, but only report a code if the email context confirms it is a real redeemable offer.
- Report each distinct code exactly once; if one code has multiple tiers or conditions, combine them into a single entry's conditions field
- discount_amount must be a plain number only (e.g. 20, 10.5) — no $, %, or words. Use null if there is no numeric amount (e.g. plain free shipping)
- offer_type must be "welcome" if the code contains WELCOME, SIGNUP, or SMS (case-insensitive), OR if conditions mention first order/purchase/subscriber; otherwise use "standard"
- discount_type must be exactly one of: percentage, fixed, free_shipping, other
- expiry_date must be YYYY-MM-DD or null
- Return {"codes": []} if no valid redeemable code is found
- Return JSON only — no markdown, no explanation`;

const EXTRACTION_USER = (body, sourceDate) => `Email received: ${sourceDate}

---
${body.slice(0, 12000)}
---

Extract and return a single JSON object with this exact shape:
{
  "codes": [
    {
      "winery_name": string,
      "code": string,
      "discount_amount": number | null,
      "discount_type": "percentage" | "fixed" | "free_shipping" | "other",
      "description": string | null,
      "conditions": string | null,
      "expiry_date": "YYYY-MM-DD" | null,
      "offer_type": "welcome" | "standard",
      "source_email_date": "YYYY-MM-DD" | null
    }
  ]
}`;

function sanitizeDiscountAmount(v) {
  if (v == null) return null;
  const cleaned = String(v).replace(/[^0-9.]/g, '');
  if (!cleaned) return null;
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : null;
}

function parseExtraction(text) {
  const jsonMatch = String(text || '').match(/\{[\s\S]*\}/);
  if (!jsonMatch) return [];
  let parsed;
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch {
    return [];
  }
  // New shape: { codes: [...] }. Tolerate the legacy single-object shape too.
  let codes;
  if (Array.isArray(parsed?.codes)) {
    codes = parsed.codes;
  } else if (parsed?.has_code && parsed?.code) {
    codes = [parsed];
  } else {
    codes = [];
  }
  return codes
    .filter(c => c && typeof c.code === 'string' && c.code.trim())
    .map(c => ({
      ...c,
      code: c.code.trim(),
      discount_amount: sanitizeDiscountAmount(c.discount_amount),
    }));
}

async function extractWithClaude(emailBody, sourceDate) {
  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    system: EXTRACTION_SYSTEM,
    messages: [{ role: 'user', content: EXTRACTION_USER(emailBody, sourceDate) }],
  });
  const text = message.content?.[0]?.text || '';
  return parseExtraction(text);
}

// ── Supabase helpers ───────────────────────────────────────────────────────────

function normalizeWineryName(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')  // strip accents: Supéry → supery
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')                        // strip punctuation incl. curly apostrophes
    .replace(/\s+/g, ' ')
    .trim();
}

const GENERIC_NAME_WORDS = new Set([
  'winery', 'wineries', 'wine', 'wines', 'vineyard', 'vineyards',
  'cellar', 'cellars', 'estate', 'estates', 'family', 'co', 'company', 'collection',
]);

function coreWineryName(normalized) {
  const kept = normalized.split(' ').filter(w => !GENERIC_NAME_WORDS.has(w));
  return (kept.length ? kept : normalized.split(' ')).join(' ');
}

function buildWineryMatcher(rows) {
  const byNormalized = new Map();
  const byCompactCore = new Map(); // space-free core → rows (may collide, e.g. Ghost Block / Ghost Block Estate Wines)
  for (const row of rows) {
    const norm = normalizeWineryName(row.name);
    const compactCore = coreWineryName(norm).replace(/ /g, '');
    if (!byNormalized.has(norm)) byNormalized.set(norm, row);
    if (!byCompactCore.has(compactCore)) byCompactCore.set(compactCore, []);
    byCompactCore.get(compactCore).push(row);
  }
  return {
    find(name) {
      if (!name) return null;
      const norm = normalizeWineryName(name);
      if (!norm) return null;

      // 1. Exact normalized match ("PEJU Winery" ≡ "peju winery")
      const exact = byNormalized.get(norm);
      if (exact) return exact;

      // 2. Compact-core match: strips spacing + generic suffix words, so
      //    "Longmeadow Ranch" ≡ "Long Meadow Ranch", "Robert Mondavi" ≡ "Robert Mondavi Winery".
      //    Only accept when unambiguous.
      const compactCore = coreWineryName(norm).replace(/ /g, '');
      const coreHits = byCompactCore.get(compactCore) || [];
      if (coreHits.length === 1) return coreHits[0];
      if (coreHits.length > 1) return null; // ambiguous → flag for manual review, never guess

      // 3. Containment fallback for prefix variants ("Peju Province Winery" → "PEJU Winery").
      //    Email-side core must be ≥5 chars to avoid junk substring hits (e.g. "com");
      //    DB-side keys as short as 4 ("peju") are fine because a UNIQUE hit is still required.
      if (compactCore.length >= 5) {
        const candidates = [];
        for (const [key, rowsForKey] of byCompactCore) {
          if (key.length >= 4 && (key.includes(compactCore) || compactCore.includes(key))) {
            candidates.push(...rowsForKey);
          }
        }
        if (candidates.length === 1) return candidates[0];
      }
      return null;
    },
  };
}

async function createWineryMatcher() {
  const { data, error } = await supabase
    .from('wineries')
    .select('id, name')
    .eq('is_active', true);
  if (error) throw new Error('Failed to load wineries: ' + error.message);
  return buildWineryMatcher(data || []);
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

function buildInsertSQL(extracted, winery) {
  const esc = v => v == null ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`;
  const num = v => (v == null || !Number.isFinite(Number(v))) ? 'NULL' : String(Number(v));
  return [
    'INSERT INTO promo_codes',
    '  (winery_id, winery_name, code, discount_amount, discount_type, description, conditions, expiry_date, offer_type, source_email_date, is_active, is_featured)',
    'VALUES (',
    `  ${winery.id},`,
    `  ${esc(winery.name)},`,
    `  ${esc(extracted.code)},`,
    `  ${num(extracted.discount_amount)},`,
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

async function sendDigestEmail({ scanned, codes, flagged, sqlBlock, approvalToken, runDate, gmail }) {
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

  await gmail.users.messages.send({
    userId: 'me',
    requestBody: { raw: encoded },
  });
}

// ── Main handler ───────────────────────────────────────────────────────────────

async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

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
  const gmailQuery = `after:${fmt(yesterday)} before:${fmt(today)} (promo OR discount OR code OR "% off" OR welcome OR offer OR save OR shipping OR sale OR deal OR exclusive OR complimentary)`;

  let gmail;
  try {
    gmail = makeGmailClient();
  } catch (err) {
    console.error('Gmail client init failed:', err.message);
    return res.status(500).json({ error: 'Gmail client init failed', detail: err.message });
  }

  let matcher;
  try {
    matcher = await createWineryMatcher();
  } catch (err) {
    console.error('Winery load failed:', err.message);
    return res.status(500).json({ error: 'Winery load failed', detail: err.message });
  }

  let messages;
  try {
    messages = await searchGmailMessages(gmail, gmailQuery);
  } catch (err) {
    console.error('Gmail search failed:', err.message);
    return res.status(500).json({ error: 'Gmail search failed', detail: err.message });
  }

  console.log(`Found ${messages.length} messages for ${runDate}`);

  const insertStatements = [];
  const codesForDigest = [];
  const flaggedWineries = [];
  const seenThisRun = new Set(); // prevents same code+winery inserted twice in one run
  let emailsScanned = 0;

  for (const msg of messages) {
    let email;
    try {
      email = await fetchEmailBody(gmail, msg.id);
      emailsScanned++;
    } catch (err) {
      console.error(`Failed to fetch message ${msg.id}:`, err.message);
      continue;
    }

    let extractedCodes;
    try {
      extractedCodes = await extractWithClaude(email.body, runDate);
    } catch (err) {
      console.error(`Claude extraction failed for message ${msg.id}:`, err.message);
      continue;
    }

    for (const extracted of extractedCodes) {
      extracted.source_email_date = extracted.source_email_date || runDate;

      const winery = matcher.find(extracted.winery_name);

      if (!winery) {
        flaggedWineries.push({ winery_name: extracted.winery_name, code: extracted.code });
        console.log(`Flagged (winery not matched): ${extracted.winery_name}`);
        continue;
      }

      const seenKey = `${winery.id}:${extracted.code.toUpperCase()}`;
      if (seenThisRun.has(seenKey)) {
        console.log(`Skipping in-run duplicate: ${extracted.code} for winery ${winery.id}`);
        continue;
      }

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

      seenThisRun.add(seenKey);
      insertStatements.push(buildInsertSQL(extracted, winery));
      codesForDigest.push({ ...extracted, winery_name: winery.name });
    }
  }

  const deactivation = `UPDATE promo_codes SET is_active = false WHERE expiry_date < CURRENT_DATE AND is_active = true;`;
  const sqlBlock = [...insertStatements, deactivation].join('\n\n');

  const approvalToken = crypto.randomUUID();

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

  try {
    await sendDigestEmail({
      scanned: emailsScanned,
      codes: codesForDigest,
      flagged: flaggedWineries,
      sqlBlock,
      approvalToken,
      runDate,
      gmail,
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
}

module.exports = handler;
// Pure functions exposed for unit testing only — not used by the route.
module.exports._internals = {
  extractBody,
  extractHiddenText,
  extractImageAltText,
  extractLinkCodes,
  parseExtraction,
  sanitizeDiscountAmount,
  buildWineryMatcher,
  normalizeWineryName,
  buildInsertSQL,
};
