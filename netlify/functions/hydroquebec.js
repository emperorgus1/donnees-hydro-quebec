// Backend Netlify Function — Proxy + Cache pour l'API Hydro-Québec
// OTERAUD 2026 — Codage assisté par Claude (Anthropic)

const API_URL = 'https://donnees.hydroquebec.com/api/explore/v2.1/catalog/datasets/historique-consommation-secteur-activite-ra-mois/exports/json?limit=-1';

// Cache en mémoire (persiste entre les appels à chaud, ~10 min sur Netlify)
let cache = null;
let cacheTime = null;
const CACHE_DURATION = 60 * 60 * 1000; // 1 heure en millisecondes

exports.handler = async function(event, context) {

  // En-têtes CORS — permet l'accès depuis n'importe quel domaine
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Content-Type': 'application/json'
  };

  // Répondre aux requêtes preflight OPTIONS
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  // Vérifier le cache
  const now = Date.now();
  if (cache && cacheTime && (now - cacheTime) < CACHE_DURATION) {
    console.log('Données servies depuis le cache');
    return {
      statusCode: 200,
      headers: { ...headers, 'X-Cache': 'HIT' },
      body: cache
    };
  }

  // Aller chercher les données chez Hydro-Québec
  try {
    console.log('Chargement depuis l\'API Hydro-Québec…');
    const response = await fetch(API_URL);

    if (!response.ok) {
      throw new Error(`Erreur API Hydro-Québec: ${response.status}`);
    }

    const rawData = await response.json();

    // Normaliser les données
    const data = rawData.map(r => ({
      region:  r.region_adm_qc_txt || '',
      mois:    (r.annee_mois || '').substring(0, 10),
      secteur: r.secteur || '',
      kwh:     parseFloat(r['total_kwh'] || r['Total (kWh)'] || 0)
    }));

    // Mettre en cache
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
