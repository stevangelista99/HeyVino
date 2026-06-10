-- Update deactivate-expired-codes cron to skip welcome/first-order codes
SELECT cron.unschedule('deactivate-expired-codes');

SELECT cron.schedule(
  'deactivate-expired-codes',
  '0 6 * * *',
  $$
    UPDATE promo_codes
    SET is_active = false
    WHERE expiry_date < CURRENT_DATE
    AND is_active = true
    AND (offer_type IS NULL OR offer_type <> 'welcome');
  $$
);
