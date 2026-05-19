// Backend Netlify Function — Proxy + Cache pour la demande d'électricité HQ
// OTERAUD 2026 — Codage assisté par Claude (Anthropic)

const API_URL = 'https://donnees.hydroquebec.com/api/explore/v2.1/catalog/datasets/historique-demande-electricite-quebec/exports/json?limit=-1';

let cache     = null;
let cacheTime = null;
const CACHE_DURATION = 6 * 60 * 60 * 1000; // 6 heures

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
    console.log('Cache hit — demande électricité');
    return { statusCode: 200, headers: { ...headers, 'X-Cache': 'HIT' }, body: cache };
  }

  try {
    console.log('Chargement export JSON — demande électricité…');
    const response = await fetch(API_URL);

    console.log('Status HTTP:', response.status);
    if (!response.ok) {
      const errBody = await response.text();
      throw new Error(`API ${response.status}: ${errBody.substring(0, 200)}`);
    }

    const rawData = await response.json();
    console.log('Enregistrements reçus:', rawData.length);
    if (rawData.length > 0) {
      console.log('Premier enregistrement:', JSON.stringify(rawData[0]));
    }

    if (!Array.isArray(rawData) || rawData.length === 0)
      throw new Error('Aucune donnée reçue');

    // Détecter les champs automatiquement
    const keys    = Object.keys(rawData[0]);
    const dateKey = keys.find(k => k.toLowerCase().includes('date')) || keys[0];
    const mwKey   = keys.find(k =>
      k.toLowerCase().includes('mw') ||
      k.toLowerCase().includes('demande') ||
      k.toLowerCase().includes('moyenne')
    ) || keys[1];
    console.log(`Champs — date: "${dateKey}", MW: "${mwKey}"`);

    // Formateur pour convertir en heure de Montréal
    const mtlFmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Montreal',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hour12: false
    });

    const data = rawData
      .map(r => {
        const rawDate = String(r[dateKey] || '');
        if (!rawDate) return null;
        const dt = new Date(rawDate);
        if (isNaN(dt.getTime())) return null;
        const mw = parseFloat(r[mwKey]);
        if (!mw || mw <= 0) return null;

        // Convertir en heure de Montréal
        const parts = mtlFmt.formatToParts(dt);
        const p = {};
        parts.forEach(({ type, value }) => { p[type] = value; });
        const annee  = parseInt(p.year);
        const moisN  = parseInt(p.month);
        const jourN  = parseInt(p.day);
        const heureN = parseInt(p.hour) % 24;
        const dateLocal = `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}`;

        return {
          date:  dateLocal,
          mw:    Math.round(mw * 100) / 100,
          annee: annee,
          mois:  `${p.year}-${p.month}`,
          jour:  `${p.year}-${p.month}-${p.day}`,
          heure: heureN
        };
      })
      .filter(Boolean);

    cache     = JSON.stringify(data);
    cacheTime = now;
    console.log(`✅ ${data.length} entrées mises en cache`);

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
