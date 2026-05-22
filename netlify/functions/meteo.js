/**
 * Fonction Netlify — Proxy API Hydro-Québec
 *
 * Mode 1 — Date max      : /api/meteo?dateMax=1
 * Mode 2 — Date min      : /api/meteo?dateMin=1
 * Mode 3 — Toutes stations : /api/meteo?toutesStations=1&dateDebut=X&dateFin=Y&variable=Z
 * Mode 4 — Une station   : /api/meteo?station=X&dateDebut=Y&dateFin=Z
 */

const API_BASE = 'https://donnees.hydroquebec.com/api/explore/v2.1/catalog/datasets/historique-donnees-meteo/records';
const LIMIT    = 100;

async function fetchAll(where, orderBy) {
  // Compter
  const countUrl = API_BASE + '?where=' + encodeURIComponent(where) + '&limit=0&timezone=America/Toronto';
  const countRes = await fetch(countUrl);
  if (!countRes.ok) throw new Error('API HQ ' + countRes.status);
  const total = (await countRes.json()).total_count || 0;
  if (total === 0) return [];

  // Paginer
  let all = [];
  const nbPages = Math.ceil(total / LIMIT);
  for (let p = 0; p < nbPages; p++) {
    const url = API_BASE
      + '?where='    + encodeURIComponent(where)
      + '&order_by=' + encodeURIComponent(orderBy)
      + '&limit='    + LIMIT
      + '&offset='   + (p * LIMIT)
      + '&timezone=America/Toronto';
    const res  = await fetch(url);
    if (!res.ok) throw new Error('API HQ page ' + (p + 1) + ' : ' + res.status);
    all = all.concat((await res.json()).results || []);
  }
  return all;
}

exports.handler = async function (event) {
  const headers = {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };

  const params = event.queryStringParameters || {};

  // ── MODE 1 : date max ──
  if (params.dateMax === '1') {
    try {
      const url  = API_BASE + '?limit=1&order_by=date_locale%20DESC&select=date_locale&timezone=America/Toronto';
      const res  = await fetch(url);
      if (!res.ok) throw new Error('API HQ ' + res.status);
      const raw  = ((await res.json()).results[0] || {}).date_locale || '';
      return { statusCode: 200, headers, body: JSON.stringify({ dateMax: raw.substring(0, 10) }) };
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
      const raw  = ((await res.json()).results[0] || {}).date_locale || '';
      return { statusCode: 200, headers, body: JSON.stringify({ dateMin: raw.substring(0, 10) }) };
    } catch (err) {
      return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
    }
  }

  // ── MODE 3 : toutes stations ──
  if (params.toutesStations === '1') {
    const { dateDebut, dateFin } = params;
    if (!dateDebut || !dateFin) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'dateDebut et dateFin requis.' }) };
    }
    try {
      const where    = 'date_locale >= "' + dateDebut + '" AND date_locale <= "' + dateFin + '"';
      const orderBy  = 'station ASC, date_locale ASC, heure_locale ASC';
      const results  = await fetchAll(where, orderBy);
      return { statusCode: 200, headers, body: JSON.stringify({ total: results.length, results }) };
    } catch (err) {
      return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
    }
  }

  // ── MODE 4 : une station ──
  const { station, dateDebut, dateFin } = params;
  if (!station || !dateDebut || !dateFin) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'station, dateDebut, dateFin requis.' }) };
  }
  try {
    const where   = 'station="' + station + '" AND date_locale >= "' + dateDebut + '" AND date_locale <= "' + dateFin + '"';
    const orderBy = 'date_locale ASC, heure_locale ASC';
    const results = await fetchAll(where, orderBy);
    return { statusCode: 200, headers, body: JSON.stringify({ total: results.length, results }) };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
