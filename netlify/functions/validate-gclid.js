const { createClient } = require('@supabase/supabase-js');

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
    return {
      statusCode: 405,
      headers: cors,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  let gclid;
  try {
    const body = JSON.parse(event.body || '{}');
    gclid = body.gclid;
  } catch {
    return {
      statusCode: 400,
      headers: cors,
      body: JSON.stringify({ error: 'Invalid JSON' })
    };
  }

  if (!gclid || typeof gclid !== 'string' || gclid.length < 10) {
    return {
      statusCode: 400,
      headers: cors,
      body: JSON.stringify({ error: 'Invalid gclid' })
    };
  }

  const ip =
    event.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
    event.headers['client-ip'] ||
    'unknown';
  const ua = event.headers['user-agent'] || '';

  let sb;
  try {
    sb = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_KEY
    );
  } catch {
    // se Supabase falhar, deixa o utilizador passar (fail open)
    return {
      statusCode: 200,
      headers: cors,
      body: JSON.stringify({ valid: true, reason: 'db_unavailable' })
    };
  }

  try {
    // verifica se o GCLID já foi visto antes
    const { data: existing, error: selectError } = await sb
      .from('gclid_log')
      .select('id, ip')
      .eq('gclid', gclid)
      .eq('is_replay', false)
      .limit(1);

    if (selectError) throw selectError;

    if (existing && existing.length > 0) {
      // GCLID replay detectado — regista e bloqueia
      await sb.from('gclid_log').insert({
        gclid,
        ip,
        user_agent: ua,
        is_replay: true,
        original_ip: existing[0].ip
      });

      return {
        statusCode: 200,
        headers: cors,
        body: JSON.stringify({ valid: false, replay: true })
      };
    }

    // primeiro click legítimo — regista e permite
    await sb.from('gclid_log').insert({
      gclid,
      ip,
      user_agent: ua,
      is_replay: false,
      original_ip: null
    });

    return {
      statusCode: 200,
      headers: cors,
      body: JSON.stringify({ valid: true })
    };

  } catch {
    // erro inesperado — fail open para não bloquear utilizadores reais
    return {
      statusCode: 200,
      headers: cors,
      body: JSON.stringify({ valid: true, reason: 'error_failopen' })
    };
  }
};
