// Single source of truth for how a winery's stored `region` value rolls up
// into one of the 7 region landing pages (/region/:slug). Matching is exact
// string equality against `values` — no substring/includes, no case-folding.
//
// Previously this list was hardcoded twice (api/region.js's REGIONS.dbRegions
// and api/winery.js's REGION_PAGE groups), byte-identical but drifting apart
// over time, and missing ~100 wineries' worth of legitimate AVA names. Both
// files now derive from this module so they can't diverge again.
//
// Both entries under 'long-island' after the first are single compound
// strings ("North Fork, Long Island", "Hamptons, Long Island") — the comma
// is part of the literal stored value, not a list separator.
const REGION_GROUPS = {
  'napa-valley': {
    title: 'Napa Valley',
    values: ['Napa Valley', 'Calistoga', 'Carneros', 'Coombsville', 'Howell Mountain', 'Mount Veeder', 'Oakville', 'Pritchard Hill', 'Rutherford', 'Spring Mountain', 'St. Helena', 'Stags Leap District', 'Yountville', 'Atlas Peak', 'Chiles Valley', 'Diamond Mountain', 'Oak Knoll'],
  },
  'sonoma': {
    title: 'Sonoma',
    values: ['Sonoma', 'Alexander Valley', 'Chalk Hill', 'Dry Creek Valley', 'Knights Valley', 'Russian River Valley', 'Sonoma Coast', 'Sonoma County', 'Sonoma Mountain', 'Sonoma Valley', 'Healdsburg'],
  },
  'long-island': {
    title: 'Long Island',
    values: ['Long Island', 'North Fork, Long Island', 'Hamptons, Long Island'],
  },
  'paso-robles': {
    title: 'Paso Robles',
    values: ['Paso Robles', 'Adelaida District', 'Templeton Gap District', 'Willow Creek District'],
  },
  'washington': {
    title: 'Washington',
    values: ['Washington', 'Walla Walla Valley', 'Walla Walla', 'Columbia Valley', 'Red Mountain'],
  },
  'oregon': {
    // The two parenthesised strings are literal stored values for wineries on
    // the Oregon side of the (cross-state) Walla Walla Valley AVA.
    title: 'Oregon',
    values: ['Oregon', 'Willamette Valley', 'Walla Walla Valley (Milton-Freewater, OR)', 'Walla Walla Valley (The Rocks District)'],
  },
  'lodi': {
    title: 'Lodi',
    values: ['Lodi'],
  },
};

module.exports = { REGION_GROUPS };
