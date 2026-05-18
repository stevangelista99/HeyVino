const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

module.exports = async function handler(req, res) {
  const today = new Date().toISOString().split('T')[0];

  const { data, error } = await supabase
    .from('promo_codes')
    .update({ is_active: false })
    .lt('expiry_date', today)
    .eq('is_active', true);

  console.log('Expired codes deactivated:', data);
  return res.status(200).json({ message: 'Cleanup complete', date: today });
};
