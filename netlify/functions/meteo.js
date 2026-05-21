/**
 * Fonction Netlify — Proxy API Hydro-Québec
 * Route : /api/meteo?station=BAGOTVILLE&dateDebut=2026-01-01&dateFin=2026-01-07&variable=t
 *
 * Rôle : contourner le CORS de l'API Opendatasoft en appelant
 * l'API côté serveur, puis retourner les données au navigateur.
 */

const API_BASE = 'https://donnees.hydroquebec.com/api/explore/v2.1/catalog/datasets/historique-donnees-meteo/records';
const LIMIT    = 100; // max par appel Opendatasoft

exports.handler = async function (event) {

  // ── En-têtes CORS pour autoriser le navigateur à lire la réponse ──
  const headers = {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };

  // Pré-vol CORS (navigateur envoie OPTIONS avant GET)
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  // ── Lecture des paramètres ──
  const { station, dateDebut, dateFin, variable } = event.queryStringParameters || {};

  if (!station || !dateDebut || !dateFin) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: 'Paramètres manquants : station, dateDebut, dateFin sont requis.' })
    };
  }

  // ── Construction du filtre WHERE ──
  const where    = `station="${station}" AND date_locale >= "${dateDebut}" AND date_locale <= "${dateFin}"`;
  const orderBy  = 'date_locale ASC, heure_locale ASC';

  // Champs à récupérer (on réduit la charge réseau en ne demandant que ce qu'on affiche)
  const fields = [
    'date_locale',
    'heure_locale',
    'station',
    't_c',            // température sèche
    'tf_c',           // température humide
    'hr',             // humidité relative
    'pa_hpa',         // pression atmosphérique
    'rs_kjm2h',       // rayonnement solaire
    'vv_kmh',         // vitesse du vent
    'dv'              // direction du vent
  ].join(',');

  try {
    // ── 1. Compter le total d'enregistrements ──
    const countUrl = `${API_BASE}?where=${encodeURIComponent(where)}&limit=0&timezone=America/Toronto`;
    const countRes = await fetch(countUrl);
    if (!countRes.ok) {
      const errText = await countRes.text();
      throw new Error(`API HQ erreur ${countRes.status} : ${errText}`);
    }
    const countData = await countRes.json();
    const total     = countData.total_count || 0;

    if (total === 0) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ total: 0, results: [] })
      };
    }

    // ── 2. Paginer et récupérer tous les enregistrements ──
    let allResults = [];
    let offset     = 0;
    const nbPages  = Math.ceil(total / LIMIT);

    for (let page = 0; page < nbPages; page++) {
      const url = `${API_BASE}` +
        `?where=${encodeURIComponent(where)}` +
        `&order_by=${encodeURIComponent(orderBy)}` +
        `&limit=${LIMIT}` +
        `&offset=${offset}` +
        `&timezone=America/Toronto`;

      const res  = await fetch(url);
      if (!res.ok) throw new Error(`API HQ erreur page ${page + 1} : ${res.status}`);
      const data = await res.json();
      allResults = allResults.concat(data.results || []);
      offset    += LIMIT;
    }

    // ── 3. Retourner les données ──
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ total: allResults.length, results: allResults })
    };

  } catch (err) {
    console.error('Erreur fonction meteo.js :', err.message);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message })
    };
  }
};
