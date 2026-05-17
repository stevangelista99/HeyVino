export const config = { api: { bodyParser: { sizeLimit: '1mb' } } };

import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@supabase/supabase-js';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const emailContent = JSON.stringify(req.body);

    const message = await anthropic.messages.create({
      model: 'claude-opus-4-5',
      max_tokens: 500,
      messages: [{
        role: 'user',
        content: `Extract promo code details from this email. Return ONLY valid JSON. If no promo code exists return {"has_promo": false}. If a promo code exists return:
{"has_promo": true, "winery_name": "string", "code": "STRING", "discount_amount": "string", "discount_type": "percentage|fixed|free_shipping|other", "varietal_type": "red|white|rose|sparkling|null", "region": "string or null", "country": "string or null", "description": "string", "conditions": "string or null", "expiry_date": "YYYY-MM-DD or null", "website_url": "string or null"}

Email: ${emailContent}`
      }]
    });

    const result = JSON.parse(message.content[0].text.trim());

    if (!result.has_promo) return res.status(200).json({ message: 'No promo code found' });

    const existing = await supabase.from('promo_codes').select('id').eq('code', result.code).eq('winery_name', result.winery_name);
    if (existing.data?.length > 0) return res.status(200).json({ message: 'Code already exists' });

    await supabase.from('promo_codes').insert({
      winery_name: result.winery_name,
      code: result.code.toUpperCase(),
      discount_amount: result.discount_amount,
      discount_type: result.discount_type,
      varietal_type: result.varietal_type,
      region: result.region,
      country: result.country,
      description: result.description,
      conditions: result.conditions,
      expiry_date: result.expiry_date,
      website_url: result.website_url,
      source_email_date: new Date().toISOString().split('T')[0],
      is_active: true,
      is_featured: false
    });

    return res.status(200).json({ message: 'Promo code saved', code: result.code });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
