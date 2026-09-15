const { createClient } = require('@supabase/supabase-js');

// Dominio deste site — usado para separar os cliques por conta Ads.
const SITE_DOMAIN = 'chaveirosena.com';

/**
 * Regista um clique no botao "Ligar" (link tel:) com o IP de origem.
 *
 * Porque existe: as conversoes deste cliente sao chamadas, medidas no Google
 * Ads, e nunca chegam ao Supabase com IP. Sem isto nao ha maneira de provar que
 * a regra anti-fraude nao esta a bloquear clientes reais. Cada linha aqui e uma
 * prova de que aquele IP e gente: alimenta a whitelist "ja ligou, nunca bloquear".
 *
 * Nunca falha para o utilizador: qualquer erro devolve 200 e a chamada segue.
 */
exports.handler = async (event) => {
  const cors = {
    'Access-Control-Allow-Origin': 'https://chaveirosena.com',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: cors, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: cors, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  let gclid = null;
  let page = null;
  try {
    const body = JSON.parse(event.body || '{}');
    if (typeof body.gclid === 'string' && body.gclid.length >= 10 && body.gclid.length <= 200) {
      gclid = body.gclid;
    }
    if (typeof body.page === 'string' && body.page.length <= 300) {
      page = body.page;
    }
  } catch {
    // corpo invalido nao impede o registo do IP
  }

  const ip =
    event.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
    event.headers['client-ip'] ||
    'unknown';
  const ua = event.headers['user-agent'] || '';

  try {
    const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
    await sb.from('call_clicks').insert({
      gclid,
      ip,
      user_agent: ua,
      domain: SITE_DOMAIN,
      page
    });
  } catch {
    // fail-open de proposito: registar a chamada nunca pode atrapalhar a chamada
  }

  return { statusCode: 200, headers: cors, body: JSON.stringify({ ok: true }) };
};
