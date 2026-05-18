const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const rawBody = req.body?.body || req.body?.text || req.body?.html || req.body?.decodedContent || '';
    const subject = req.body?.subject || '';
    const from = req.body?.from || '';

    // Step 1: Extract original sender from forwarded email
    const originalFromMatch = rawBody.match(/From:\s+[^\n]*<([^>]+@[^>]+)>/);
    const effectiveFrom = (originalFromMatch && !originalFromMatch[1].includes('gmail.com'))
      ? originalFromMatch[1]
      : from;

    // Step 2: Get domain for winery name
    const domainMatch = effectiveFrom.match(/@([^.>]+)/);
    const domain = domainMatch ? domainMatch[1] : 'unknown';
    const winery_name = domain.charAt(0).toUpperCase() + domain.slice(1);

    // Step 3: Normalize text
    const text = rawBody
      .replace(/\*/g, '')
      .replace(/“|”/g, '"')
      .replace(/‘|’/g, "'")
      .replace(/https?:\/\/\S+/g, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&[a-z]+;/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    console.log('TEXT SAMPLE:', text.slice(0, 400));

    // Step 4: Find promo code
    const EXCLUDE = new Set(['WINE','WINES','WINERY','SHOP','SALE','DEAL','DEALS','FREE','THIS','THAT','WITH','FROM','HAVE','MORE','WILL','ALSO','BEEN','WERE','THEY','WHEN','WHAT','HERE','DEAR','JUST','OVER','ONLY','PLUS','SAVE','LAST','BEST','CLICK','ENJOY','MISS','DAYS','TAKE','MAKE','NEED','KNOW','COME','LOOK','GOOD','BACK','NEXT','EACH','MANY','MOST','SOME','THAN','THEN','THEM','WELL','MUCH','EVEN','AWAY','INTO','YOUR','VIEW','BOTTLE','BOTTLES','HOURS','PRICE','PRICES','RESET','FINAL','EXTRA','CASE','SAVINGS','TODAY','ORDER','ORDERS','CART','CHECKOUT','EMAIL','TERMS','STORE','SHIPPING','DELIVERY','MEMBER','MEMBERS','JOIN','SIGN','LEARN','GIFT','GIFTS','SETS','OFFER','OFFERS','ONLINE','STANDARD','GROUND','ABOUT','CONTACT','PRIVACY','UNSUBSCRIBE','LOGIN','ACCOUNT','CART','SHOP']);

    const patterns = [
      /promo(?:tion)?\s+code\s*[:\s]*["']?([A-Z0-9]{4,20})["']?/gi,
      /use\s+code\s*[:\s]*["']?([A-Z0-9]{4,20})["']?/gi,
      /discount\s+code\s*[:\s]*["']?([A-Z0-9]{4,20})["']?/gi,
      /coupon\s*[:\s]*["']?([A-Z0-9]{4,20})["']?/gi,
      /enter\s+["']?([A-Z0-9]{4,20})["']?\s+at\s+checkout/gi,
      /"([A-Z0-9]{4,20})"\s+at\s+checkout/gi,
      /"([A-Z0-9]{4,20})"\s+to\s+(?:get|save|enjoy|receive)/gi,
      /code\s+"([A-Z0-9]{4,20})"/gi,
    ];

    let code = null;
    for (const pattern of patterns) {
      pattern.lastIndex = 0;
      let match;
      while ((match = pattern.exec(text)) !== null) {
        const candidate = match[1].toUpperCase();
        if (candidate.length >= 4 && candidate.length <= 20 && !EXCLUDE.has(candidate) && /[A-Z]/.test(candidate) && !/^\d+$/.test(candidate)) {
          code = candidate;
          break;
        }
      }
      if (code) break;
    }

    console.log('CODE FOUND:', code);

    if (!code) return res.status(200).json({ message: 'No promo code found' });

    // Step 5: Check duplicate
    const existing = await supabase.from('promo_codes').select('id').eq('code', code).eq('winery_name', winery_name);
    if (existing.data?.length > 0) return res.status(200).json({ message: 'Code already exists', code });

    // Step 6: Extract discount
    let discount_amount = null, discount_type = 'other';
    const pct = text.match(/(\d+)%\s*(?:off|discount|savings?)|save\s+(\d+)%|up\s+to\s+(\d+)%/i);
    if (pct) { discount_amount = `${pct[1]||pct[2]||pct[3]}% Off`; discount_type = 'percentage'; }
    const fixed = text.match(/\$(\d+)\s*off/i);
    if (fixed) { discount_amount = `$${fixed[1]} Off`; discount_type = 'fixed'; }
    if (/free\s*shipping/i.test(text)) { discount_amount = discount_amount || 'Free Shipping'; discount_type = discount_type === 'other' ? 'free_shipping' : discount_type; }

    // Step 7: Detect varietal and region
    let varietal_type = null;
    if (/cabernet|merlot|pinot\s*noir|syrah|shiraz|malbec|sangiovese|brunello|chianti|zinfandel/i.test(text)) varietal_type = 'red';
    else if (/chardonnay|sauvignon\s*blanc|riesling|pinot\s*grigio|trebbiano|chenin/i.test(text)) varietal_type = 'white';
    else if (/ros[eé]/i.test(text)) varietal_type = 'rose';
    else if (/sparkling|champagne|prosecco|cava|metodo\s*classico/i.test(text)) varietal_type = 'sparkling';

    let region = null, country = 'USA';
    if (/napa/i.test(text)) { region = 'Napa Valley'; }
    else if (/sonoma/i.test(text)) { region = 'Sonoma'; }
    else if (/willamette/i.test(text)) { region = 'Willamette Valley'; }
    else if (/tuscany|toscana|cortona/i.test(text)) { region = 'Tuscany'; country = 'Italy'; }
    else if (/burgundy/i.test(text)) { region = 'Burgundy'; country = 'France'; }

    // Step 8: Save
    await supabase.from('promo_codes').insert({
      winery_name, code, discount_amount, discount_type, varietal_type,
      region, country, description: subject.slice(0, 200) || text.slice(0, 200),
      website_url: `https://www.${domain}.com`,
      source_email_date: new Date().toISOString().split('T')[0],
      is_active: true, is_featured: false
    });

    return res.status(200).json({ message: 'Saved', code, winery: winery_name });

  } catch (error) {
    console.error('ERROR:', error.message);
    return res.status(500).json({ error: error.message });
  }
};
