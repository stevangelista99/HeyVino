// v3
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

const DOMAIN_CORRECTIONS = {
  'wineinsiders': 'Wine Insiders',
  'wineaccess': 'Wine Access',
  'wineenthusiast': 'Wine Enthusiast',
  'nakedwines': 'Naked Wines',
  'lastbottle': 'Last Bottle Wines',
  'klwines': 'K&L Wine Merchants',
  'robertmondavi': 'Robert Mondavi Winery',
  'ste-michelle': 'Chateau Ste. Michelle',
  'ponzivineyards': 'Ponzi Vineyards',
  'argylewinery': 'Argyle Winery',
  'heitzcellar': 'Heitz Cellar',
  'cakebread': 'Cakebread Cellars',
  'farniente': 'Far Niente Winery',
  'silveroak': 'Silver Oak Cellars',
  'casaemma': 'Casa Emma',
  'baracchiwinery': 'Baracchi Winery'
};

function extractWineryName(rawBody, fromEmail) {
  // 1. Check sender email domain directly
  const directDomainMatch = (fromEmail || '').match(/@([^.>]+)\./);
  if (directDomainMatch) {
    const domain = directDomainMatch[1].toLowerCase();
    const displayName = domain
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/\b\w/g, c => c.toUpperCase())
      .trim();
    if (displayName && !['Gmail', 'Yahoo', 'Hotmail', 'Outlook', 'Icloud'].includes(displayName)) {
      return DOMAIN_CORRECTIONS[domain] || displayName;
    }
  }

  // 2. Try "From:" line inside forwarded email
  const fwdFromMatch = rawBody.match(/From:\s+([^<\n]+?)\s*</);
  if (fwdFromMatch) {
    const name = fwdFromMatch[1].trim();
    if (name && !name.toLowerCase().includes('gmail') && !name.toLowerCase().includes('stephen')) {
      return name;
    }
  }

  // 3. Try email signature — "Warm regards, Winery Name" or "The Winery Name Team"
  const signatureMatch = rawBody.match(/(?:regards|sincerely|cheers|warmly|thank you)[,\.\s\n]+([A-Z][A-Za-z\s&'.]{3,50}?)(?:\n|Team|Winery|Cellars|Vineyards|Estate)/i);
  if (signatureMatch) return signatureMatch[1].trim();

  // 4. Try "Welcome to X" or "Thank you for joining X"
  const welcomeMatch = rawBody.match(/(?:welcome to|thank you for joining|joining the)\s+([A-Z][A-Za-z\s&'.]{3,50}?)(?:\s+(?:family|mailing|community|newsletter|list)|[!\.,])/i);
  if (welcomeMatch) return welcomeMatch[1].trim();

  // 5. Try "from X" in subject context
  const fromMatch = rawBody.match(/(?:exclusive offer|gift|message|update)\s+from\s+([A-Z][A-Za-z\s&'.]{3,50}?)(?:[!\.,\n])/i);
  if (fromMatch) return fromMatch[1].trim();

  // 6. Fall back to domain with proper formatting
  const domainMatch = (fromEmail || '').match(/@([^.]+)/);
  if (domainMatch) {
    const domain = domainMatch[1].toLowerCase();
    const displayName = domain
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .split(/(?=[A-Z])/).join(' ')
      .replace(/\b\w/g, c => c.toUpperCase())
      .trim();
    return DOMAIN_CORRECTIONS[domain] || displayName;
  }

  return 'Unknown Winery';
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  let rawBody = '';
  let subject = '';
  let from = '';

  try {
    rawBody = req.body?.body || req.body?.text || req.body?.html || req.body?.decodedContent || '';
    subject = req.body?.subject || '';
    from = req.body?.from || '';

    // If rawBody is undefined or the string "undefined", try parsing req.body as raw string
    if (!rawBody || rawBody === 'undefined') {
      const bodyStr = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
      rawBody = bodyStr;
    }
  } catch(e) {
    rawBody = '';
  }

  console.log('RAW BODY LENGTH:', rawBody.length);
  console.log('RAW BODY START:', rawBody.slice(0, 100));

  try {
    if (subject === 'undefined') subject = '';
    if (from === 'undefined') from = '';

    // Step 1 & 2: Determine winery name and domain
    const originalFromMatch = rawBody.match(/From:\s+[^\n<]*<([^>]+@[^>]+)>/);
    const senderEmail = (originalFromMatch && !originalFromMatch[1].includes('gmail.com'))
      ? originalFromMatch[1]
      : from;

    const domainMatch = (senderEmail || from || '').match(/@([^.>]+)/);
    const domain = domainMatch ? domainMatch[1] : 'unknown';

    const winery_name = extractWineryName(rawBody, senderEmail || from);

    // Step 3: Normalize text
    // Extract text after last forwarded message header block
    const lastFwdIndex = rawBody.lastIndexOf('---------- Forwarded message');
    const bodyToProcess = lastFwdIndex !== -1 ? rawBody.slice(lastFwdIndex) : rawBody;

    const text = bodyToProcess
      .replace(/\*/g, '')
      .replace(/"|"/g, '"')
      .replace(/'|'/g, "'")
      .replace(/<https?:\/\/[^>]+>/g, ' ')
      .replace(/\bhttps?:\/\/[^\s<>"{}|\\^`[\]]+/g, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&[a-z]+;/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    console.log('TEXT SAMPLE:', text.slice(0, 400));

    // Step 4: Find promo code
    const EXCLUDE = new Set(['WINE','WINES','WINERY','SHOP','SALE','DEAL','DEALS','FREE','THIS','THAT','WITH','FROM','HAVE','MORE','WILL','ALSO','BEEN','WERE','THEY','WHEN','WHAT','HERE','DEAR','JUST','OVER','ONLY','PLUS','SAVE','LAST','BEST','CLICK','ENJOY','MISS','DAYS','TAKE','MAKE','NEED','KNOW','COME','LOOK','GOOD','BACK','NEXT','EACH','MANY','MOST','SOME','THAN','THEN','THEM','WELL','MUCH','EVEN','AWAY','INTO','YOUR','VIEW','BOTTLE','BOTTLES','HOURS','PRICE','PRICES','RESET','FINAL','EXTRA','CASE','SAVINGS','TODAY','ORDER','ORDERS','CART','CHECKOUT','EMAIL','TERMS','STORE','SHIPPING','DELIVERY','MEMBER','MEMBERS','JOIN','SIGN','LEARN','GIFT','GIFTS','SETS','OFFER','OFFERS','ONLINE','STANDARD','GROUND','ABOUT','CONTACT','PRIVACY','UNSUBSCRIBE','LOGIN','ACCOUNT','CART','SHOP']);

    const patterns = [
      /use\s+promo\s+code\s+([A-Z0-9]{4,20})/gi,
      /enter\s+code\s+([A-Z0-9]{4,20})/gi,
      /apply\s+code\s+([A-Z0-9]{4,20})/gi,
      /use\s+([A-Z0-9]{4,20})\s+at\s+checkout/gi,
      /code\s+([A-Z0-9]{4,20})\s+at\s+checkout/gi,
      /discount\s+code[:\s]+([A-Z0-9]{4,20})/gi,
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

    // Step 6b: Extract expiry date
    let expiry_date = null;
    const expiryPatterns = [
      /(?:expires?|valid\s+(?:through|until)|ends?|offer\s+ends?|savings?\s+end|use\s+by|through)\s+([A-Za-z]+\s+\d{1,2},?\s+\d{4})/i,
      /(?:expires?|valid\s+(?:through|until)|ends?|offer\s+ends?|savings?\s+end|use\s+by)\s+(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i,
      /(?:expires?|valid\s+(?:through|until)|ends?)\s+([A-Za-z]+\s+\d{1,2}(?:,?\s+\d{4})?)/i,
    ];
    for (const pattern of expiryPatterns) {
      const match = text.match(pattern);
      if (match) {
        const parsed = new Date(match[1]);
        if (!isNaN(parsed)) {
          expiry_date = parsed.toISOString().split('T')[0];
          break;
        }
      }
    }

    // Step 6c: Extract conditions
    const conditionsPatterns = [
      /(?:minimum|min\.?)\s+(?:order|purchase|spend)?\s*(?:of\s*)?\$?[\d,]+\+?[^.]{0,50}/gi,
      /(?:orders?|purchases?)\s+(?:over|of|above)\s+\$?[\d,]+[^.]{0,50}/gi,
      /\d+\+?\s+bottles?\s+[^.]{0,60}/gi,
      /(?:one|1|limit\s+one)\s+(?:use|per|time)[^.]{0,60}/gi,
      /(?:first|new)\s+(?:order|purchase|customers?|time)[^.]{0,60}/gi,
      /one\s+per\s+(?:customer|household|person|account)[^.]{0,60}/gi,
      /(?:cannot|can't|not)\s+(?:be\s+)?combined[^.]{0,80}/gi,
      /(?:excludes?|exclusions?)\s+[^.]{0,80}/gi,
      /(?:online\s+only|in.store\s+only)[^.]{0,40}/gi,
      /while\s+supplies\s+last[^.]{0,40}/gi,
    ];
    const conditionMatches = [];
    const seen = new Set();
    for (const pattern of conditionsPatterns) {
      pattern.lastIndex = 0;
      const matches = [...text.matchAll(pattern)];
      for (const match of matches) {
        const clean = match[0].trim().replace(/\s+/g, ' ');
        if (clean.length > 10 && !seen.has(clean.toLowerCase().slice(0, 30))) {
          seen.add(clean.toLowerCase().slice(0, 30));
          conditionMatches.push(clean);
        }
      }
    }
    const conditions = conditionMatches.length > 0
      ? conditionMatches.slice(0, 3).join('. ').slice(0, 250)
      : null;

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
    console.log('ATTEMPTING SAVE:', JSON.stringify({winery_name, code, discount_amount, varietal_type, region, country}));
    try {
      const insertResult = await supabase.from('promo_codes').insert({
        winery_name, code, discount_amount, discount_type, varietal_type,
        region, country, conditions, expiry_date, description: subject.slice(0, 200) || text.slice(0, 200),
        website_url: `https://www.${domain}.com`,
        source_email_date: new Date().toISOString().split('T')[0],
        is_active: true, is_featured: false
      });
      console.log('INSERT RESULT:', JSON.stringify(insertResult));
    } catch(insertError) {
      console.log('INSERT ERROR:', insertError.message);
      return res.status(500).json({ error: insertError.message });
    }

    return res.status(200).json({ message: 'Saved', code, winery: winery_name });

  } catch (error) {
    console.error('ERROR:', error.message);
    return res.status(500).json({ error: error.message });
  }
};
