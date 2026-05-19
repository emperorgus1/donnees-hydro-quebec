// Backend Netlify Function — Pagination + Cache pour la demande d'électricité HQ
// OTERAUD 2026 — Codage assisté par Claude (Anthropic)

const DATASET_ID  = 'historique-demande-electricite-quebec';
const API_BASE    = `https://donnees.hydroquebec.com/api/explore/v2.1/catalog/datasets/${DATASET_ID}`;
const PAGE_SIZE   = 1000;
const CONCURRENCY = 5;

let cache     = null;
let cacheTime = null;
const CACHE_DURATION = 6 * 60 * 60 * 1000; // 6 heures

function detectFields(record) {
  const keys = Object.keys(record);
  const dateKey = keys.find(k => k.toLowerCase().includes('date')) || keys[0];
  const mwKey   = keys.find(k =>
    k.toLowerCase().includes('mw') ||
    k.toLowerCase().includes('demande') ||
    k.toLowerCase().includes('moyenne')
  ) || keys[1];
  return { dateKey, mwKey };
}

function normalizeRecord(r, dateKey, mwKey) {
  const dateStr = String(r[dateKey] || '').substring(0, 19);
  if (!dateStr) return null;
  const dt = new Date(dateStr);
  if (isNaN(dt.getTime())) return null;
  const mw = parseFloat(r[mwKey]);
  if (!mw || mw <= 0) return null;
  return {
    date:  dateStr,
    mw:    Math.round(mw * 100) / 100,
    annee: dt.getFullYear(),
    mois:  `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}`,
    jour:  dt.toISOString().substring(0, 10),
    heure: dt.getHours()
  };
}

async function fetchPage(offset) {
  // Sans order_by pour éviter l'erreur 400
  const url = `${API_BASE}/records?limit=${PAGE_SIZE}&offset=${offset}`;
  const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Erreur API offset=${offset}: ${res.status} — ${body.substring(0,200)}`);
  }
  return res.json();
}

exports.handler = async function(event, context) {
  context.callbackWaitsForEmptyEventLoop = false;

  const headers = {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  const now = Date.now();
  if (cache && cacheTime && (now - cacheTime) < CACHE_DURATION) {
    console.log('Cache hit');
    return { statusCode: 200, headers: { ...headers, 'X-Cache': 'HIT' }, body: cache };
  }

  try {
    console.log('Début chargement paginé…');

    const firstPage = await fetchPage(0);
    const total     = firstPage.total_count;
    const pages     = Math.ceil(total / PAGE_SIZE);
    console.log(`Total: ${total} entrées, ${pages} pages`);
    console.log('Premier enregistrement:', JSON.stringify(firstPage.results[0]));

    const { dateKey, mwKey } = detectFields(firstPage.results[0]);
    console.log(`Champs — date: "${dateKey}", MW: "${mwKey}"`);

    let allResults = firstPage.results
      .map(r => normalizeRecord(r, dateKey, mwKey))
      .filter(Boolean);

    const offsets = [];
    for (let offset = PAGE_SIZE; offset < total; offset += PAGE_SIZE) {
      offsets.push(offset);
    }

    for (let i = 0; i < offsets.length; i += CONCURRENCY) {
      const chunk   = offsets.slice(i, i + CONCURRENCY);
      const results = await Promise.all(chunk.map(offset => fetchPage(offset)));
      results.forEach(page => {
        page.results
          .map(r => normalizeRecord(r, dateKey, mwKey))
          .filter(Boolean)
          .forEach(r => allResults.push(r));
      });
      console.log(`Pages traitées: ${Math.min(i + CONCURRENCY + 1, pages)} / ${pages}`);
    }

    allResults.sort((a, b) => a.date.localeCompare(b.date));

    cache     = JSON.stringify(allResults);
    cacheTime = now;
    console.log(`✅ ${allResults.length} entrées mises en cache`);

    return {
      statusCode: 200,
      headers: { ...headers, 'X-Cache': 'MISS' },
      body: cache
    };

  } catch (err) {
    console.error('Erreur:', err.message);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ erreur: err.message })
    };
  }
};
