module.exports.config = { api: { bodyParser: { sizeLimit: '1mb' } } };

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

function extractPromoCode(subject, body, from) {
  // Normalize text — remove asterisks, replace smart quotes with straight quotes
  const normalize = (text) => text
    .replace(/\*/g, '')
    .replace(/\u201c|\u201d/g, '"')
    .replace(/\u2018|\u2019/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"');

  const rawText = `${subject} ${body}`;
  const text = normalize(rawText);

  // Common words to exclude from code detection
  const EXCLUDE = new Set(['HTTP', 'HTML', 'VIEW', 'SHOP', 'WINE', 'YOUR', 'FREE', 'THIS', 'THAT', 'WITH', 'FROM', 'HAVE', 'MORE', 'WILL', 'ALSO', 'BEEN', 'WERE', 'THEY', 'WHEN', 'WHAT', 'HERE', 'DEAR', 'JUST', 'OVER', 'ONLY', 'PLUS', 'SAVE', 'SALE', 'LAST', 'BEST', 'WINE', 'WINES', 'WINERY', 'CLICK', 'SHOP', 'ENJOY', 'MISS', 'DAYS', 'TAKE', 'MAKE', 'NEED', 'KNOW', 'COME', 'LOOK', 'GOOD', 'BACK', 'NEXT', 'CASE', 'EACH', 'BOTH', 'MANY', 'MOST', 'SOME', 'SUCH', 'THAN', 'THEN', 'THEM', 'WELL', 'BEEN', 'MUCH', 'EVEN', 'ALSO', 'AWAY', 'INTO', 'DOES', 'MADE', 'SAID', 'USED']);

  const isValidCode = (candidate) => {
    if (!candidate) return false;
    const c = candidate.toUpperCase();
    if (c.length < 4 || c.length > 20) return false;
    if (EXCLUDE.has(c)) return false;
    if (!/[A-Z]/.test(c)) return false; // must have at least one letter
    if (/^[0-9]+$/.test(c)) return false; // not all numbers
    return true;
  };

  // Code patterns — ordered from most specific to least specific
  const codePatterns = [
    // “CODE” at checkout (with normalized straight quotes)
    /promo\s+code\s+”([A-Z0-9]{4,20})”/gi,
    /use\s+code[:\s]+”([A-Z0-9]{4,20})”/gi,
    /code[:\s]+”([A-Z0-9]{4,20})”/gi,
    /”([A-Z0-9]{4,20})”\s+at\s+checkout/gi,
    /”([A-Z0-9]{4,20})”\s+to\s+(?:get|save|enjoy|receive)/gi,
    // Code without quotes near keywords
    /promo\s+code[:\s]+([A-Z0-9]{4,20})/gi,
    /use\s+code[:\s]+([A-Z0-9]{4,20})/gi,
    /coupon\s+code[:\s]+([A-Z0-9]{4,20})/gi,
    /enter\s+code[:\s]+([A-Z0-9]{4,20})/gi,
    /apply\s+code[:\s]+([A-Z0-9]{4,20})/gi,
    /discount\s+code[:\s]+([A-Z0-9]{4,20})/gi,
    // Code followed by action
    /([A-Z0-9]{4,20})\s+at\s+checkout/gi,
    /([A-Z0-9]{4,20})\s+to\s+(?:get|save|enjoy|receive)\s+\d+%/gi,
    // Generic quoted code
    /”([A-Z0-9]{4,20})”/g,
  ];

  let code = null;
  for (const pattern of codePatterns) {
    pattern.lastIndex = 0;
    const matches = [...text.matchAll(pattern)];
    for (const match of matches) {
      const candidate = match[1]?.toUpperCase();
      if (isValidCode(candidate)) {
        code = candidate;
        break;
      }
    }
    if (code) break;
  }

  if (!code) return null;

  // Extract winery name from sender email domain
  const senderMatch = from.match(/@([^.]+)/);
  const senderDomain = senderMatch ? senderMatch[1] : 'unknown';
  const winery_name = senderDomain.charAt(0).toUpperCase() + senderDomain.slice(1);

  // Discount patterns
  let discount_amount = null;
  let discount_type = 'other';

  const freeShip = text.match(/free\s*shipping/gi);
  if (freeShip) { discount_amount = 'Free Shipping'; discount_type = 'free_shipping'; }

  const pctMatch = text.match(/(\d+)%\s*(?:off|discount|savings?)|save\s+(\d+)%|up\s+to\s+(\d+)%/i);
  if (pctMatch) {
    const pct = pctMatch[1] || pctMatch[2] || pctMatch[3];
    discount_amount = `${pct}% Off`;
    discount_type = 'percentage';
  }

  const fixedMatch = text.match(/\$(\d+)\s*off/i);
  if (fixedMatch) { discount_amount = `$${fixedMatch[1]} Off`; discount_type = 'fixed'; }

  // Varietal detection
  let varietal_type = null;
  if (/cabernet|merlot|pinot\s+noir|syrah|shiraz|malbec|zinfandel|sangiovese|nebbiolo|tempranillo|brunello|chianti/i.test(rawText)) varietal_type = 'red';
  else if (/chardonnay|sauvignon\s+blanc|riesling|pinot\s+grigio|viognier|chenin|trebbiano|soave/i.test(rawText)) varietal_type = 'white';
  else if (/ros[eé]|rosato/i.test(rawText)) varietal_type = 'rose';
  else if (/sparkling|champagne|prosecco|cava|cremant|metodo\s+classico|pét\s*nat/i.test(rawText)) varietal_type = 'sparkling';

  // Region and country detection
  let region = null;
  let country = 'USA';
  const regionMap = [
    [/napa/i, 'Napa Valley', 'USA'],
    [/sonoma/i, 'Sonoma', 'USA'],
    [/willamette/i, 'Willamette Valley', 'USA'],
    [/walla\s+walla/i, 'Walla Walla Valley', 'USA'],
    [/columbia\s+valley/i, 'Columbia Valley', 'USA'],
    [/paso\s+robles/i, 'Paso Robles', 'USA'],
    [/burgundy|bourgogne/i, 'Burgundy', 'France'],
    [/bordeaux/i, 'Bordeaux', 'France'],
    [/champagne/i, 'Champagne', 'France'],
    [/rh[oô]ne/i, 'Rhône Valley', 'France'],
    [/tuscany|toscana|cortona|chianti/i, 'Tuscany', 'Italy'],
    [/piedmont|piemonte|barolo|barbaresco/i, 'Piedmont', 'Italy'],
    [/veneto|prosecco/i, 'Veneto', 'Italy'],
    [/marlborough/i, 'Marlborough', 'New Zealand'],
    [/central\s+otago/i, 'Central Otago', 'New Zealand'],
    [/barossa/i, 'Barossa Valley', 'Australia'],
    [/mendoza/i, 'Mendoza', 'Argentina'],
    [/rioja/i, 'Rioja', 'Spain'],
    [/mosel/i, 'Mosel', 'Germany'],
  ];

  for (const [pattern, reg, ctry] of regionMap) {
    if (pattern.test(rawText)) { region = reg; country = ctry; break; }
  }

  // Expiry detection
  let expiry_date = null;
  const expiryMatch = text.match(/(?:expires?|valid\s+(?:through|until)|ends?|through|until)\s+(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/i);
  if (expiryMatch) {
    const [_, m, d, y] = expiryMatch;
    const year = y.length === 2 ? `20${y}` : y;
    expiry_date = `${year}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`;
  }

  const website_url = `https://www.${senderDomain}.com`;

  return {
    code,
    winery_name,
    discount_amount,
    discount_type,
    varietal_type,
    region,
    country,
    expiry_date,
    description: subject.slice(0, 200),
    conditions: null,
    website_url
  };
}

function extractForwardedBody(body) {
  const fwdIndex = body.indexOf('---------- Forwarded message');
  if (fwdIndex === -1) return body;
  return body.slice(fwdIndex);
}

function extractOriginalSender(body) {
  const fwdMatch = body.match(/From:\s+.+<([^>]+)>/);
  return fwdMatch ? fwdMatch[1] : null;
}

function cleanBody(raw) {
  if (!raw) return '';
  return raw
    .replace(/<[^>]+>/g, ' ')          // strip HTML tags
    .replace(/&nbsp;/g, ' ')           // decode &nbsp;
    .replace(/&amp;/g, '&')            // decode &amp;
    .replace(/&lt;/g, '<')             // decode &lt;
    .replace(/&gt;/g, '>')             // decode &gt;
    .replace(/&quot;/g, '"')           // decode &quot;
    .replace(/&#39;/g, "'")            // decode &#39;
    .replace(/https?:\/\/\S+/g, ' ')  // remove URLs
    .replace(/\s+/g, ' ')             // collapse whitespace
    .trim();
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { subject = '', from = '', body = '', text = '', html = '' } = req.body;
    const rawBody = extractForwardedBody(text || body || html);
    const cleanedBody = cleanBody(rawBody);
    const effectiveFrom = extractOriginalSender(rawBody) || from;
    console.log('NORMALIZED SAMPLE:', cleanedBody.slice(0, 500));
    const result = extractPromoCode(subject, cleanedBody, effectiveFrom);

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
