-- Create wineries table
CREATE TABLE IF NOT EXISTS public.wineries (
  id          INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name        TEXT,
  slug        TEXT UNIQUE,
  region      TEXT,
  country     TEXT,
  website_url TEXT,
  is_active   BOOLEAN DEFAULT true,
  created_at  TIMESTAMP DEFAULT now()
);

-- Seed from promo_codes
INSERT INTO wineries (name, slug, region, country, website_url)
SELECT DISTINCT
  winery_name,
  lower(regexp_replace(winery_name, '[^a-zA-Z0-9]+', '-', 'g')) as slug,
  country,
  country,
  website_url
FROM promo_codes
ON CONFLICT (slug) DO NOTHING;
