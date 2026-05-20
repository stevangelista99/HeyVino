const { google } = require('googleapis');
const { createClient } = require('@supabase/supabase-js');
const Anthropic = require('@anthropic-ai/sdk');
const ws = require('ws');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  { realtime: { transport: ws } }
);

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const auth = new google.auth.OAuth2(
  process.env.GMAIL_CLIENT_ID,
  process.env.GMAIL_CLIENT_SECRET
);
auth.setCredentials({ refresh_token: process.env.GMAIL_REFRESH_TOKEN });

const gmail = google.gmail({ version: 'v1', auth });

async function getRecentPromoEmails() {
  const res = await gmail.users.messages.list({
    userId: 'me',
    q: 'newer_than:2d (promo OR discount OR "promo code" OR "discount code" OR "% off" OR coupon)',
    maxResults: 20,
  });
  return res.data.messages || [];
}

async function getEmailBody(messageId) {
  const res = await gmail.users.messages.get({
    userId: 'me',
    id: messageId,
    format: 'full',
  });

  const parts = res.data.payload.parts || [res.data.payload];
  for (const part of parts) {
    if (part.mimeType === 'text/plain' && part.body?.data) {
      return Buffer.from(part.body.data, 'base64').toString('utf-8');
    }
  }
  for (const part of parts) {
    if (part.mimeType === 'text/html' && part.body?.data) {
      return Buffer.from(part.body.data, 'base64').toString('utf-8');
    }
  }
  return '';
}

async function extractPromoWithClaude(emailBody, sender) {
  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1000,
    messages: [
      {
        role: 'user',
        content: `Extract any wine promo codes from this email. Return JSON only, no markdown.

Format:
{
  "promos": [
    {
      "code": "PROMO CODE HERE",
      "discount": "e.g. 20% off or $10 off",
      "expiry_date": "YYYY-MM-DD or null",
      "winery_name": "name of winery or retailer",
      "description": "brief description"
    }
  ]
}

Sender: ${sender}
Email:
${emailBody.slice(0, 3000)}`
      }
    ]
  });

  try {
    const text = message.content[0].text;
    return JSON.parse(text);
  } catch {
    return { promos: [] };
  }
}

async function getOrCreateWinery(name) {
  const { data: existing } = await supabase
    .from('wineries')
    .select('id')
    .ilike('name', name)
    .single();

  if (existing) return existing.id;

  const { data: newWinery } = await supabase
    .from('wineries')
    .insert({ name, region_id: null })
    .select('id')
    .single();

  return newWinery?.id;
}

async function savePromo(promo) {
  const wineryId = await getOrCreateWinery(promo.winery_name);
  if (!wineryId) return;

  const { data: existing } = await supabase
    .from('promo_codes')
    .select('id')
    .eq('code', promo.code)
    .single();

  if (existing) {
    console.log(`Skipping duplicate code: ${promo.code}`);
    return;
  }

  const { error } = await supabase.from('promo_codes').insert({
    code: promo.code,
    discount: promo.discount,
    expiry_date: promo.expiry_date || null,
    winery_id: wineryId,
    description: promo.description,
    is_active: true,
  });

  if (error) {
    console.error(`Error saving ${promo.code}:`, error.message);
  } else {
    console.log(`Saved: ${promo.code} (${promo.winery_name})`);
  }
}

async function expireOldCodes() {
  const today = new Date().toISOString().split('T')[0];
  const { error } = await supabase
    .from('promo_codes')
    .update({ is_active: false })
    .not('expiry_date', 'is', null)
    .lt('expiry_date', today)
    .eq('is_active', true);

  if (error) {
    console.error('Error expiring old codes:', error.message);
  } else {
    console.log('Expired old promo codes.');
  }
}

async function deleteStaleCodes() {
  const sixtyDaysAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  const { error: err1 } = await supabase
    .from('promo_codes')
    .delete()
    .not('expiry_date', 'is', null)
    .lt('expiry_date', sixtyDaysAgo);

  if (err1) console.error('Error deleting expired stale codes:', err1.message);

  const { error: err2 } = await supabase
    .from('promo_codes')
    .delete()
    .is('expiry_date', null)
    .lt('created_at', sixtyDaysAgo)
    .eq('is_active', false);

  if (err2) console.error('Error deleting no-expiry stale codes:', err2.message);

  if (!err1 && !err2) console.log('Deleted stale promo codes.');
}

async function main() {
  console.log('Starting daily promo update...');
  const messages = await getRecentPromoEmails();
  console.log(`Found ${messages.length} emails to process`);

  for (const msg of messages) {
    const full = await gmail.users.messages.get({ userId: 'me', id: msg.id, format: 'metadata' });
    const headers = full.data.payload.headers;
    const sender = headers.find(h => h.name === 'From')?.value || 'Unknown';

    const body = await getEmailBody(msg.id);
    if (!body) continue;

    const result = await extractPromoWithClaude(body, sender);
    for (const promo of result.promos) {
      await savePromo(promo);
    }
  }

  await expireOldCodes();
  await deleteStaleCodes();
  console.log('Done!');
}

main().catch(console.error);
