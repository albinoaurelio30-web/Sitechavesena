// ---------------------------------------------------------------------------
// /r — sensor de cliques (Netlify Edge, Deno).  Fase 2, 2026-09-22.
//
// REGRA DE OURO: constroi o Location, responde 302, e SO DEPOIS grava.
// Nunca ha um await a base de dados antes da resposta. A gravacao vai toda
// para context.waitUntil(), que corre depois de o utilizador ja ter arrancado.
//
// FAIL-OPEN EM TODOS OS CAMINHOS:
//   sem parametros        -> redirect para a homepage
//   u malformado          -> redirect para a homepage
//   base de dados em baixo-> redirect na mesma (a gravacao morre em silencio)
//   excecao inesperada    -> redirect na mesma
// O clique ja foi pago quando isto corre. Nada aqui pode custar a visita.
//
// Template a gravar no Google Ads (ver Fase 3 — so depois dos testes):
//   https://chaveirosena.com/r?u={lpurl}&g={gclid}&kw={keyword}
//   &mt={matchtype}&d={device}&cid={campaignid}&aid={adgroupid}&cr={creative}
//   &net={network}&loc={loc_physical_ms}&tgt={targetid}&rnd={random}
// ---------------------------------------------------------------------------

const SITE_DOMAIN = "chaveirosena.com";
const HOMEPAGE = "https://chaveirosena.com/";

// ACRESCENTADO POR MIM (nao estava na spec): lista branca de destinos.
// Sem isto, /r?u=https://sitio-mau.com e' um open redirect — o dominio passa a
// relay de phishing e a Google pode sinalizar o site. So se redireciona para casa.
const HOSTS_PERMITIDOS = new Set([
  "chaveirosena.com",
  "www.chaveirosena.com",
]);

const MAX = 500; // teto por campo, para ninguem encher a tabela por /r

function corta(v: string | null): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (!s) return null;
  return s.length > MAX ? s.slice(0, MAX) : s;
}

// {lpurl} chega URL-encoded em posicao de parametro. O URLSearchParams ja
// descodifica uma vez; se ainda vier codificado (setups que codificam a dobrar),
// descodifica outra vez. Para quando estabiliza ou ao fim de 3 voltas.
function descodificarLpurl(bruto: string | null): string | null {
  if (!bruto) return null;
  let v = bruto;
  for (let i = 0; i < 3; i++) {
    if (!/%(3A|2F|3F|3D|26)/i.test(v)) break;
    try {
      const d = decodeURIComponent(v);
      if (d === v) break;
      v = d;
    } catch {
      break;
    }
  }
  return v;
}

function destinoValido(u: string | null): URL | null {
  if (!u) return null;
  try {
    const url = new URL(u);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (!HOSTS_PERMITIDOS.has(url.hostname.toLowerCase())) return null;
    url.protocol = "https:";
    return url;
  } catch {
    return null;
  }
}

function env(nome: string): string | undefined {
  try {
    // @ts-ignore — Netlify expoe isto nas Edge Functions
    if (typeof Netlify !== "undefined" && Netlify.env) return Netlify.env.get(nome);
  } catch {}
  try {
    // @ts-ignore
    return Deno.env.get(nome);
  } catch {}
  return undefined;
}

async function gravar(linha: Record<string, unknown>): Promise<void> {
  try {
    const base = env("SUPABASE_URL");
    const key = env("SUPABASE_SERVICE_KEY");
    if (!base || !key) return; // sem credenciais nao se grava; o redirect ja foi
    await fetch(base.replace(/\/+$/, "") + "/rest/v1/click_log", {
      method: "POST",
      headers: {
        apikey: key,
        Authorization: "Bearer " + key,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify(linha),
    });
  } catch {
    // silencio de proposito: a gravacao nunca pode afetar o utilizador
  }
}

export default async (request: Request, context: any): Promise<Response> => {
  const clickId =
    (globalThis.crypto && crypto.randomUUID && crypto.randomUUID()) ||
    String(Date.now()) + "-" + Math.random().toString(16).slice(2);

  let location = HOMEPAGE;
  let linha: Record<string, unknown> | null = null;

  // --- 1. construir o destino (nunca lanca para fora) ---
  try {
    const url = new URL(request.url);
    const p = url.searchParams;
    const alvo = destinoValido(descodificarLpurl(p.get("u")));

    if (alvo) {
      // O gclid tem de seguir para a landing page, senao o site perde-o e a
      // validate-gclid / log-call ficam sem chave. So se acrescenta se faltar.
      const g = corta(p.get("g"));
      if (g && !alvo.searchParams.has("gclid")) alvo.searchParams.set("gclid", g);
      location = alvo.toString();
    }

    // --- 2. montar a linha, mesmo que o destino nao se tenha reconstruido ---
    // O clique foi cobrado na mesma; tem de ficar registado.
    let ip: string | null = null;
    try {
      ip =
        corta(request.headers.get("x-nf-client-connection-ip")) ||
        corta((request.headers.get("x-forwarded-for") || "").split(",")[0]) ||
        corta(context && context.ip) ||
        null;
    } catch {}

    linha = {
      id: clickId,
      gclid: corta(p.get("g")),
      ip,
      user_agent: corta(request.headers.get("user-agent")),
      device_id: null, // o /r corre antes de existir JS; preenchido depois (ver link-device)
      campaign_id: corta(p.get("cid")),
      adgroup_id: corta(p.get("aid")),
      creative_id: corta(p.get("cr")),
      keyword: corta(p.get("kw")),
      matchtype: corta(p.get("mt")),
      network: corta(p.get("net")),
      device: corta(p.get("d")),
      loc_physical_ms: corta(p.get("loc")),
      loc_nome: null, // resolvido FORA do caminho do clique, a partir da geo_target
      targetid: corta(p.get("tgt")),
      random: corta(p.get("rnd")),
      // query string CRUA, sem interpretacao. Existe para responder ao misterio
      // do {lpurl}: com parallel tracking o Google nao parece substitui-lo dentro
      // de um parametro, e sem o cru nao se sabe se chega vazio, literal ou roto.
      raw_query: url.search ? url.search.slice(0, 2000) : null,
      landing_url: location === HOMEPAGE ? null : corta(location),
      domain: SITE_DOMAIN,
    };
  } catch {
    // fail-open: seja o que for, redireciona-se para casa
    location = HOMEPAGE;
  }

  // --- 3. responder JA ---
  const resposta = new Response(null, {
    status: 302,
    headers: {
      Location: location,
      "Cache-Control": "no-store, private",
      // ponte para o device_id: o /r nao conhece o localStorage do browser.
      // O main.js le este cookie e cruza-o com o device_id em /link-device.
      "Set-Cookie": `cs_click=${clickId}; Path=/; Max-Age=1800; SameSite=Lax; Secure`,
    },
  });

  // --- 4. gravar depois da resposta ---
  try {
    if (linha && context && typeof context.waitUntil === "function") {
      context.waitUntil(gravar(linha));
    }
  } catch {
    // se o waitUntil nao existir, perde-se o registo — nunca a visita
  }

  return resposta;
};

export const config = { path: "/r" };
