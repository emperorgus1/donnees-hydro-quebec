/**
 * Fonction Netlify : /api/hydroquebec-mrc
 *
 * Charge toutes les données MRC en parallèle pour battre le timeout de 10s.
 * Stratégie :
 *   1. Premier appel pour connaître le total et la première page
 *   2. Tous les appels restants en parallèle par lots de 20 (Promise.all)
 *   3. Normalisation et retour en une seule réponse
 */

const API_URL =
  'https://donnees.hydroquebec.com/api/explore/v2.1/catalog/datasets/' +
  'historique-consommation-secteur-activite-mrc-mois/records';

const LIMIT = 100;
const BATCH = 20; // appels simultanés par lot

// Cache mémoire Lambda (~10 min)
let _cache = null;
let _cacheTime = null;
const CACHE_MS = 10 * 60 * 1000;

async function fetchPage(offset) {
  const url = `${API_URL}?limit=${LIMIT}&offset=${offset}` +
    `&select=mrc_txt,region_adm_qc_txt,annee_mois,secteur,total_kwh`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`API HQ MRC ${res.status} à offset ${offset}`);
  const json = await res.json();
  return json.results;
}

exports.handler = async function (event, context) {
  context.callbackWaitsForEmptyEventLoop = false;

  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'public, max-age=3600',
  };

  try {
    const now = Date.now();
    if (_cache && _cacheTime && now - _cacheTime < CACHE_MS) {
      return { statusCode: 200, headers: { ...headers, 'X-Cache': 'HIT' }, body: _cache };
    }

    // 1. Premier appel : récupérer le total et la première page
    const firstRes = await fetch(`${API_URL}?limit=${LIMIT}&offset=0` +
      `&select=mrc_txt,region_adm_qc_txt,annee_mois,secteur,total_kwh`);
    if (!firstRes.ok) throw new Error(`API HQ MRC ${firstRes.status}`);
    const firstJson = await firstRes.json();
    const total = firstJson.total_count;
    const allResults = [...firstJson.results];

    // 2. Calculer les offsets restants
    const offsets = [];
    for (let offset = LIMIT; offset < total; offset += LIMIT) {
      offsets.push(offset);
    }

    // 3. Fetch parallèle par lots de BATCH
    for (let i = 0; i < offsets.length; i += BATCH) {
      const batch = offsets.slice(i, i + BATCH);
      const pages = await Promise.all(batch.map(fetchPage));
      pages.forEach(p => allResults.push(...p));
    }

    // 4. Normaliser
    const data = allResults.map(r => ({
      region:     r.mrc_txt,
      region_adm: r.region_adm_qc_txt,
      mois:       r.annee_mois,
      secteur:    r.secteur,
      kwh:        r.total_kwh,
    }));

    const body = JSON.stringify(data);
    _cache = body;
    _cacheTime = now;

    console.log(`MRC chargé : ${data.length} entrées en ${Date.now() - now}ms`);

    return { statusCode: 200, headers: { ...headers, 'X-Cache': 'MISS' }, body };

  } catch (err) {
    console.error('hydroquebec-mrc error:', err.message);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
