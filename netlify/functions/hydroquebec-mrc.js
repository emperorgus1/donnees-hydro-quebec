/**
 * Fonction Netlify : /api/hydroquebec-mrc
 *
 * Charge l'intégralité des données de consommation par MRC depuis l'API
 * Hydro-Québec (paginées par 100), les normalise et les retourne en une
 * seule réponse JSON.
 *
 * Format de sortie : tableau d'objets
 *   { region, region_adm, mois, secteur, kwh }
 */

const API_URL =
  'https://donnees.hydroquebec.com/api/explore/v2.1/catalog/datasets/' +
  'historique-consommation-secteur-activite-mrc-mois/records';

const LIMIT = 100;

// Cache en mémoire (dure le temps de vie de l'instance Lambda, ~5-15 min)
let _cache = null;
let _cacheTime = null;
const CACHE_DURATION = 10 * 60 * 1000; // 10 minutes

exports.handler = async function (event, context) {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'public, max-age=3600',
  };

  try {
    // Servir depuis le cache si disponible
    const now = Date.now();
    if (_cache && _cacheTime && now - _cacheTime < CACHE_DURATION) {
      return {
        statusCode: 200,
        headers: { ...headers, 'X-Cache': 'HIT' },
        body: _cache,
      };
    }

    // Pagination côté serveur
    let offset = 0;
    let total = null;
    const allResults = [];

    do {
      const url = `${API_URL}?limit=${LIMIT}&offset=${offset}` +
        `&select=mrc_txt,region_adm_qc_txt,annee_mois,secteur,total_kwh`;

      const res = await fetch(url);
      if (!res.ok) {
        throw new Error(`API Hydro-Québec MRC : ${res.status} ${res.statusText}`);
      }

      const json = await res.json();
      if (total === null) total = json.total_count;
      allResults.push(...json.results);
      offset += LIMIT;
    } while (offset < total);

    // Normaliser vers le même format que les données régions
    const data = allResults.map(r => ({
      region:     r.mrc_txt,
      region_adm: r.region_adm_qc_txt,
      mois:       r.annee_mois,
      secteur:    r.secteur,
      kwh:        r.total_kwh,
    }));

    const body = JSON.stringify(data);

    // Mettre en cache
    _cache = body;
    _cacheTime = now;

    return {
      statusCode: 200,
      headers: { ...headers, 'X-Cache': 'MISS' },
      body,
    };
  } catch (err) {
    console.error('Erreur hydroquebec-mrc:', err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
