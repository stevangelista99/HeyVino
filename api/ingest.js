import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

function extractPromoCode(subject, body, from) {
  const text = `${subject} ${body}`;

  // Match promo codes — uppercase words 4-20 chars, often near keywords
  const codePatterns = [
    /["“”]([A-Z0-9]{4,20})["“”]/g,
    /promo\s+code\s+["“”]?([A-Z0-9]{4,20})["“”]?/gi,
    /code\s+["“”]([A-Z0-9]{4,20})["“”]/gi,
    /["“”]([A-Z0-9]{4,20})["“”]\s+at\s+checkout/gi,
    /(?:code|promo|coupon|use|enter|apply)[:\s]+([A-Z0-9]{4,20})/gi,
    /([A-Z0-9]{4,20})\s+(?:for|to get|to save|off)/gi,
    /\b([A-Z]{2,}[0-9]{1,4}|[A-Z0-9]{5,15})\b/g
  ];

  // Discount patterns
  const discountPatterns = [
    /(\d+)%\s*off/gi,
    /\$(\d+)\s*off/gi,
    /free\s*shipping/gi,
    /save\s+(\d+)%/gi,
    /(\d+)%\s*savings/gi,
    /up\s+to\s+(\d+)%/gi
  ];

  // Expiry patterns
  const expiryPatterns = [
    /(?:expires?|valid through|ends?|until|through)\s+(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/gi,
    /(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/g
  ];

  // Extract winery name from sender
  const senderDomain = from.replace(/.*@/, '').replace(/\..+/, '');
  const winery_name = senderDomain.charAt(0).toUpperCase() + senderDomain.slice(1);

  // Find promo code
  let code = null;
  for (const pattern of codePatterns) {
    const matches = [...text.matchAll(pattern)];
    for (const match of matches) {
      const candidate = match[1]?.toUpperCase();
      if (candidate && candidate.length >= 4 && candidate.length <= 20 &&
          !['HTTP', 'HTML', 'VIEW', 'SHOP', 'WINE', 'YOUR', 'FREE', 'THIS', 'THAT', 'WITH', 'FROM', 'HAVE', 'MORE', 'WILL', 'ALSO', 'BEEN', 'WERE', 'THEY', 'WHEN', 'WHAT', 'HERE'].includes(candidate)) {
        code = candidate;
        break;
      }
    }
    if (code) break;
  }

  if (!code) return null;

  // Find discount
  let discount_amount = null;
  let discount_type = 'other';
  const freeShip = text.match(/free\s*shipping/gi);
  if (freeShip) { discount_amount = 'Free Shipping'; discount_type = 'free_shipping'; }
  const pctMatch = text.match(/(\d+)%\s*off|save\s+(\d+)%|up\s+to\s+(\d+)%/i);
  if (pctMatch) {
    const pct = pctMatch[1] || pctMatch[2] || pctMatch[3];
    discount_amount = `${pct}% Off`;
    discount_type = 'percentage';
  }
  const fixedMatch = text.match(/\$(\d+)\s*off/i);
  if (fixedMatch) { discount_amount = `$${fixedMatch[1]} Off`; discount_type = 'fixed'; }

  // Find expiry
  let expiry_date = null;
  const expiryMatch = text.match(/(?:expires?|valid through|ends?|until|through)\s+(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/i);
  if (expiryMatch) {
    const [_, m, d, y] = expiryMatch;
    const year = y.length === 2 ? `20${y}` : y;
    expiry_date = `${year}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`;
  }

  // Detect varietal type
  let varietal_type = null;
  if (/cabernet|merlot|pinot\s+noir|syrah|shiraz|malbec|zinfandel|sangiovese|nebbiolo|tempranillo/i.test(text)) varietal_type = 'red';
  else if (/chardonnay|sauvignon\s+blanc|riesling|pinot\s+grigio|viognier|chenin/i.test(text)) varietal_type = 'white';
  else if (/rosé|rose|rosato/i.test(text)) varietal_type = 'rose';
  else if (/sparkling|champagne|prosecco|cava|cremant/i.test(text)) varietal_type = 'sparkling';

  // Detect region
  let region = null;
  let country = 'USA';
  if (/napa/i.test(text)) { region = 'Napa Valley'; country = 'USA'; }
  else if (/sonoma/i.test(text)) { region = 'Sonoma'; country = 'USA'; }
  else if (/willamette/i.test(text)) { region = 'Willamette Valley'; country = 'USA'; }
  else if (/burgundy|bourgogne/i.test(text)) { region = 'Burgundy'; country = 'France'; }
  else if (/bordeaux/i.test(text)) { region = 'Bordeaux'; country = 'France'; }
  else if (/tuscany|toscana/i.test(text)) { region = 'Tuscany'; country = 'Italy'; }
  else if (/marlborough/i.test(text)) { region = 'Marlborough'; country = 'New Zealand'; }
  else if (/barossa/i.test(text)) { region = 'Barossa Valley'; country = 'Australia'; }

  return { code, winery_name, discount_amount, discount_type, varietal_type, region, country, expiry_date,
    description: subject.slice(0, 200),
    website_url: `https://www.${senderDomain}.com`
  };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { subject = '', from = '', body = '' } = req.body;
    const result = extractPromoCode(subject, body, from);

    if (!result || !result.code) return res.status(200).json({ message: 'No promo code found' });

    const existing = await supabase.from('promo_codes').select('id').eq('code', result.code).eq('winery_name', result.winery_name);
    if (existing.data?.length > 0) return res.status(200).json({ message: 'Code already exists' });

    await supabase.from('promo_codes').insert({
      ...result,
      source_email_date: new Date().toISOString().split('T')[0],
      is_active: true,
      is_featured: false
    });

    return res.status(200).json({ message: 'Saved', code: result.code });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
