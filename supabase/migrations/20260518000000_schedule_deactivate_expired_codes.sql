SELECT cron.schedule(
  'deactivate-expired-codes',
  '0 6 * * *',
  $$
    UPDATE promo_codes
    SET is_active = false
    WHERE expiry_date < CURRENT_DATE
    AND is_active = true;
  $$
);
