const { createClient } = require('@supabase/supabase-js');

// Dominio deste site.
const SITE_DOMAIN = 'chaveirosena.com';

/**
 * Liga o device_id do browser a linha que o /r gravou na click_log.
 *
 * Porque existe: o /r e' uma Edge Function que corre ANTES de existir qualquer
 * JS na pagina, por isso nao pode conhecer o localStorage. Grava o clique com
 * device_id nulo e poe um cookie cs_click com o id da linha. O main.js le esse
 * cookie, junta-lhe o device_id do localStorage e chama isto uma unica vez.
 *
 * E' assim que os cliques SEM gclid tambem ficam ligados a um dispositivo —
 * e sao precisamente esses que o gclid_log nunca viu.
 *
 * Nunca falha para o utilizador: qualquer erro devolve 200.
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

  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  let clickId = null;
  let deviceId = null;
  let gclid = null;
  try {
    const body = JSON.parse(event.body || '{}');
    if (typeof body.click_id === 'string' && UUID.test(body.click_id)) {
      clickId = body.click_id;
    }
    if (typeof body.device_id === 'string' && body.device_id.length >= 8 && body.device_id.length <= 100) {
      deviceId = body.device_id;
    }
    if (typeof body.gclid === 'string' && body.gclid.length >= 10 && body.gclid.length <= 200) {
      gclid = body.gclid;
    }
  } catch {
    // corpo invalido: nada a fazer, mas nunca rebenta
  }

  if (!deviceId || (!clickId && !gclid)) {
    return { statusCode: 200, headers: cors, body: JSON.stringify({ ok: true, skipped: true }) };
  }

  try {
    const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

    // 1. carimbar a linha que o /r gravou (cobre os cliques SEM gclid)
    if (clickId) {
      await sb
        .from('click_log')
        .update({ device_id: deviceId })
        .eq('id', clickId)
        .is('device_id', null); // nunca reescreve um device_id ja posto
    }

    // 2. carimbar o gclid_log do primeiro pouso.
    //    A validate-gclid corre num script inline no <head>, antes de o main.js
    //    existir, por isso num visitante NOVO ainda nao ha cookie cs_device e a
    //    primeira linha fica sem device_id. Este backfill fecha esse buraco sem
    //    obrigar a mexer nos 41 HTML que trazem o snippet inline.
    if (gclid) {
      await sb
        .from('gclid_log')
        .update({ device_id: deviceId })
        .eq('gclid', gclid)
        .is('device_id', null);
    }
  } catch {
    // fail-open de proposito
  }

  return { statusCode: 200, headers: cors, body: JSON.stringify({ ok: true }) };
};
