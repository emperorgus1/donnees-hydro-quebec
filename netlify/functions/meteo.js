/**
 * Fonction Netlify — Proxy API Hydro-Québec
 *
 * Mode 1 — Date max : /api/meteo?dateMax=1
 *   Retourne { dateMax: "YYYY-MM-DD" }
 *
 * Mode 2 — Date min : /api/meteo?dateMin=1
 *   Retourne { dateMin: "YYYY-MM-DD" }
 *
 * Mode 3 — Données  : /api/meteo?station=X&dateDebut=YYYY-MM-DD&dateFin=YYYY-MM-DD
 *   Retourne { total: N, results: [...] }
 */

const API_BASE = 'https://donnees.hydroquebec.com/api/explore/v2.1/catalog/datasets/historique-donnees-meteo/records';
const LIMIT    = 100;

exports.handler = async function (event) {

  const headers = {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  const params = event.queryStringParameters || {};

  // ── MODE 1 : date max ──
  if (params.dateMax === '1') {
    try {
      const url  = API_BASE + '?limit=1&order_by=date_locale%20DESC&select=date_locale&timezone=America/Toronto';
      const res  = await fetch(url);
      if (!res.ok) throw new Error('API HQ ' + res.status);
      const data = await res.json();
      const raw  = (data.results && data.results[0] && data.results[0].date_locale) || '';
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ dateMax: raw.substring(0, 10) })
      };
    } catch (err) {
      return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
    }
  }

  // ── MODE 2 : date min ──
  if (params.dateMin === '1') {
    try {
      const url  = API_BASE + '?limit=1&order_by=date_locale%20ASC&select=date_locale&timezone=America/Toronto';
      const res  = await fetch(url);
      if (!res.ok) throw new Error('API HQ ' + res.status);
      const data = await res.json();
      const raw  = (data.results && data.results[0] && data.results[0].date_locale) || '';
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ dateMin: raw.substring(0, 10) })
      };
    } catch (err) {
      return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
    }
  }

  // ── MODE 3 : charger les données ──
  const station   = params.station;
  const dateDebut = params.dateDebut;
  const dateFin   = params.dateFin;

  if (!station || !dateDebut || !dateFin) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: 'Paramètres manquants : station, dateDebut, dateFin sont requis.' })
    };
  }

  const where   = 'station="' + station + '" AND date_locale >= "' + dateDebut + '" AND date_locale <= "' + dateFin + '"';
  const orderBy = 'date_locale ASC, heure_locale ASC';

  try {
    const countUrl = API_BASE + '?where=' + encodeURIComponent(where) + '&limit=0&timezone=America/Toronto';
    const countRes = await fetch(countUrl);
    if (!countRes.ok) throw new Error('API HQ ' + countRes.status);
    const countData = await countRes.json();
    const total     = countData.total_count || 0;

    if (total === 0) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ total: 0, results: [] })
      };
    }

    let allResults = [];
    let offset     = 0;
    const nbPages  = Math.ceil(total / LIMIT);

    for (let page = 0; page < nbPages; page++) {
      const url = API_BASE
        + '?where='    + encodeURIComponent(where)
        + '&order_by=' + encodeURIComponent(orderBy)
        + '&limit='    + LIMIT
        + '&offset='   + offset
        + '&timezone=America/Toronto';
      const res  = await fetch(url);
      if (!res.ok) throw new Error('API HQ page ' + (page + 1) + ' : ' + res.status);
      const data = await res.json();
      allResults = allResults.concat(data.results || []);
      offset    += LIMIT;
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ total: allResults.length, results: allResults })
    };

  } catch (err) {
    console.error('Erreur meteo.js :', err.message);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message })
    };
  }
};
