const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// Retailers whose codes should be force-deactivated after N days regardless
// of expiry_date. Wine Insiders sends frequent rotating promos that rarely
// carry a real expiry_date, so the normal expiry-based cleanup below never
// catches them — this is a second, independent safety net.
const MAX_AGE_RULES = [
  { slug: 'wine-insiders', maxAgeDays: 30 },
];

async function deactivateStaleRetailerCodes(slug, maxAgeDays) {
  const { data: winery, error: wErr } = await supabase
    .from('wineries')
    .select('id')
    .eq('slug', slug)
    .limit(1);

  if (wErr) {
    console.error(`Lookup failed for winery slug "${slug}":`, wErr.message);
    return { slug, deactivated: 0, error: wErr.message };
  }
  if (!winery || winery.length === 0) {
    console.error(`No winery found for slug "${slug}" — skipping max-age rule`);
    return { slug, deactivated: 0, error: 'winery not found' };
  }

  const cutoff = new Date(Date.now() - maxAgeDays * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from('promo_codes')
    .update({ is_active: false })
    .eq('winery_id', winery[0].id)
    .eq('is_active', true)
    .lt('created_at', cutoff)
    .select('id, code');

  if (error) {
    console.error(`Max-age cleanup failed for "${slug}":`, error.message);
    return { slug, deactivated: 0, error: error.message };
  }
  return { slug, deactivated: (data || []).length, codes: (data || []).map(r => r.code) };
}

module.exports = async function handler(req, res) {
  const today = new Date().toISOString().split('T')[0];

  const { data: expiredData, error: expiredError } = await supabase
    .from('promo_codes')
    .update({ is_active: false })
    .lt('expiry_date', today)
    .eq('is_active', true)
    .select('id, code');

  if (expiredError) console.error('Expiry cleanup failed:', expiredError.message);
  console.log('Expired codes deactivated:', (expiredData || []).length);

  const maxAgeResults = [];
  for (const rule of MAX_AGE_RULES) {
    maxAgeResults.push(await deactivateStaleRetailerCodes(rule.slug, rule.maxAgeDays));
  }
  console.log('Max-age deactivations:', maxAgeResults);

  return res.status(200).json({
    message: 'Cleanup complete',
    date: today,
    expired_deactivated: (expiredData || []).length,
    max_age_deactivated: maxAgeResults,
  });
};

module.exports._internals = { deactivateStaleRetailerCodes, MAX_AGE_RULES };
