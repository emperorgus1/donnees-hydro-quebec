// Backend Netlify Function — Proxy + Cache pour la demande d'électricité HQ
// OTERAUD 2026 — Codage assisté par Claude (Anthropic)

const API_URL = 'https://donnees.hydroquebec.com/api/explore/v2.1/catalog/datasets/historique-demande-electricite-quebec/exports/json?limit=-1';

let cache = null;
let cacheTime = null;
const CACHE_DURATION = 60 * 60 * 1000; // 1 heure

exports.handler = async function(event, context) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  // Vérifier le cache
  const now = Date.now();
  if (cache && cacheTime && (now - cacheTime) < CACHE_DURATION) {
    console.log('Données demande servies depuis le cache');
    return {
      statusCode: 200,
      headers: { ...headers, 'X-Cache': 'HIT' },
      body: cache
    };
  }

  try {
    console.log('Chargement depuis l\'API Hydro-Québec — demande électricité…');
    const response = await fetch(API_URL);

    if (!response.ok) throw new Error(`Erreur API: ${response.status}`);

    const rawData = await response.json();

    // Normaliser les données
    const data = rawData.map(r => {
      const dateStr = r.date || r.DATE || '';
      const dt = new Date(dateStr);
      return {
        date:   dateStr,
        mw:     parseFloat(r['moyenne_mw'] || r['demande (MW)'] || r['demande_mw'] || 0),
        annee:  dt.getFullYear(),
        mois:   dt.toISOString().substring(0, 7),
        jour:   dt.toISOString().substring(0, 10),
        heure:  dt.getHours()
      };
    }).filter(r => r.mw > 0);

    cache = JSON.stringify(data);
    cacheTime = now;

    console.log(`${data.length} entrées chargées et mises en cache`);

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
