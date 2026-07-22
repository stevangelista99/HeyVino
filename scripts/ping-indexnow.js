// Submits all sitemap.xml URLs to IndexNow so Bing/Yandex/etc. pick up
// changes fast instead of waiting on their normal crawl schedule.
// Requires the key file at the site root (<KEY>.txt) to stay in sync with KEY
// below — IndexNow verifies key by fetching keyLocation before accepting.
//
// Run after generate-sitemap.js, once URLs are current:
//   node scripts/ping-indexnow.js

const fs = require('fs');
const path = require('path');

const HOST = 'www.heyvinowine.com';
const BASE_URL = `https://${HOST}`;
const KEY = '5fc8f065cd8d81288c0210ed663d8192';
const KEY_LOCATION = `${BASE_URL}/${KEY}.txt`;

function loadSitemapUrls() {
  const xml = fs.readFileSync(path.join(__dirname, '..', 'sitemap.xml'), 'utf8');
  const urls = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]);
  if (!urls.length) throw new Error('No URLs found in sitemap.xml — aborting.');
  return urls;
}

async function ping(urls) {
  const res = await fetch('https://api.indexnow.org/indexnow', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({
      host: HOST,
      key: KEY,
      keyLocation: KEY_LOCATION,
      urlList: urls,
    }),
  });

  // IndexNow returns 200 or 202 on success; anything else is a failure.
  if (res.status !== 200 && res.status !== 202) {
    const text = await res.text().catch(() => '');
    throw new Error(`IndexNow submission failed: HTTP ${res.status} ${text}`);
  }
  console.log(`IndexNow: submitted ${urls.length} URLs — HTTP ${res.status}`);
}

const urls = loadSitemapUrls();
ping(urls).catch(err => { console.error(err.message); process.exit(1); });
