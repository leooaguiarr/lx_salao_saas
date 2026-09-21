// Service worker do painel Lexion Salão.
//
// O que ele faz:
//   1. Torna o painel instalável como aplicativo (o Chrome exige um SW com
//      handler de fetch para oferecer a instalação).
//   2. Deixa a interface abrir rápido e mesmo sem sinal, a partir do cache.
//
// O que ele NÃO faz: guardar dados. Agenda, clientes e vendas vêm do Supabase
// a cada abertura; sem conexão a tela abre, mas as listas dependem da rede.
// Por isso /api/ e o host do Supabase nunca passam por aqui.
//
// Suba a VERSAO quando mudar a lógica deste arquivo. Para CSS/JS não precisa:
// eles já trocam de endereço pelo ?v= do index.html, e o SW descarta a versão
// anterior de cada arquivo sozinho.

const VERSAO = 'lexion-v1';
const CACHE_APP = `${VERSAO}-app`;
const CACHE_EXTERNO = `${VERSAO}-externo`;

// Página que responde quando não há rede: todas as rotas do painel servem o
// mesmo index.html, então /app vale por qualquer uma delas.
const PAGINA_OFFLINE = '/app';

const ARQUIVOS_FIXOS = [
  PAGINA_OFFLINE,
  '/manifest.webmanifest',
  '/assets/icon-192.png',
  '/assets/icon-512.png',
  '/assets/icon-maskable-512.png',
  '/assets/logo_lexion.png',
  '/assets/favicon_lexion.png'
];

// Bibliotecas e fontes de terceiros que valem cachear.
const HOSTS_ESTATICOS = [
  'fonts.googleapis.com',
  'fonts.gstatic.com',
  'cdnjs.cloudflare.com',
  'cdn.jsdelivr.net'
];

// Lê o index.html e devolve o que ele carrega: os CSS/JS próprios, já com o
// ?v= atual, e as bibliotecas dos CDNs (Font Awesome, supabase-js, fontes).
// Assim a lista do que precisa estar offline nunca fica desatualizada.
async function arquivosDaPagina() {
  try {
    const html = await (await fetch(PAGINA_OFFLINE, { cache: 'no-store' })).text();
    const enderecos = [...html.matchAll(/(?:href|src)="([^"]+)"/g)].map(m => m[1]);
    return {
      proprios: enderecos.filter(e => /^\/[^/].*\.(?:css|js)(?:\?|$)/.test(e)),
      externos: enderecos.filter(e => {
        try { return HOSTS_ESTATICOS.includes(new URL(e).hostname); } catch { return false; }
      })
    };
  } catch {
    return { proprios: [], externos: [] };
  }
}

// Guarda uma biblioteca de CDN. Os CDNs da lista respondem com CORS, então
// dá para ler o CSS e guardar junto as fontes que ele puxa por url(...) —
// sem elas, os ícones do Font Awesome virariam quadrados offline.
async function guardarExterno(cache, endereco) {
  let resposta;
  try {
    resposta = await fetch(endereco, { mode: 'cors' });
  } catch {
    // CDN sem CORS: guarda opaca mesmo, que ao menos a página consegue usar.
    resposta = await fetch(endereco, { mode: 'no-cors' });
  }
  if (!resposta.ok && resposta.type !== 'opaque') return;
  await cache.put(endereco, resposta.clone());

  const tipo = resposta.headers.get('content-type') || '';
  if (resposta.type === 'opaque' || !tipo.includes('css')) return;
  const css = await resposta.text();
  const fontes = [...css.matchAll(/url\(\s*['"]?([^'")]+\.woff2)(?:[?#][^'")]*)?['"]?\s*\)/g)]
    .map(m => new URL(m[1], endereco).href);
  await Promise.allSettled([...new Set(fontes)].map(fonte => cache.add(fonte)));
}

self.addEventListener('install', evento => {
  evento.waitUntil((async () => {
    const { proprios, externos } = await arquivosDaPagina();
    const cacheApp = await caches.open(CACHE_APP);
    const cacheExterno = await caches.open(CACHE_EXTERNO);
    // addAll falha inteiro se um arquivo faltar; aqui cada um é independente.
    await Promise.allSettled([
      ...[...ARQUIVOS_FIXOS, ...proprios].map(caminho => cacheApp.add(caminho)),
      ...externos.map(endereco => guardarExterno(cacheExterno, endereco))
    ]);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', evento => {
  evento.waitUntil((async () => {
    const nomes = await caches.keys();
    await Promise.all(nomes
      .filter(nome => nome !== CACHE_APP && nome !== CACHE_EXTERNO)
      .map(nome => caches.delete(nome)));
    await self.clients.claim();
  })());
});

// Guarda a resposta e apaga as outras versões do mesmo arquivo (index.css?v=60
// quando chega o ?v=61), para o cache não crescer a cada deploy.
async function guardar(cache, requisicao, resposta) {
  const url = new URL(requisicao.url);
  if (url.search) {
    const chaves = await cache.keys();
    await Promise.all(chaves
      .filter(chave => {
        const antiga = new URL(chave.url);
        return antiga.origin === url.origin && antiga.pathname === url.pathname && antiga.search !== url.search;
      })
      .map(chave => cache.delete(chave)));
  }
  await cache.put(requisicao, resposta);
}

self.addEventListener('fetch', evento => {
  const requisicao = evento.request;
  if (requisicao.method !== 'GET') return;

  const url = new URL(requisicao.url);
  const mesmaOrigem = url.origin === self.location.origin;

  if (mesmaOrigem && url.pathname.startsWith('/api/')) return;

  // Navegação: rede primeiro, para cada deploy chegar na hora; o cache só
  // entra quando não há conexão.
  if (requisicao.mode === 'navigate') {
    evento.respondWith((async () => {
      try {
        const resposta = await fetch(requisicao);
        if (resposta.ok && mesmaOrigem) {
          const cache = await caches.open(CACHE_APP);
          cache.put(url.pathname, resposta.clone());
        }
        return resposta;
      } catch {
        return (await caches.match(url.pathname))
          || (await caches.match(PAGINA_OFFLINE))
          || Response.error();
      }
    })());
    return;
  }

  const externoEstatico = HOSTS_ESTATICOS.includes(url.hostname);
  if (!mesmaOrigem && !externoEstatico) return;

  // Estáticos: responde do cache na hora e revalida em segundo plano.
  evento.respondWith((async () => {
    const cache = await caches.open(mesmaOrigem ? CACHE_APP : CACHE_EXTERNO);
    const emCache = await cache.match(requisicao);
    const naRede = fetch(requisicao).then(async resposta => {
      // O Font Awesome e as fontes vêm por <link> sem CORS: a resposta é
      // opaca (status 0) e não dá para saber se deu certo. Aceitamos esse
      // risco só para os CDNs; sem isso os ícones sumiriam offline.
      const aproveitavel = resposta && (resposta.ok || (!mesmaOrigem && resposta.type === 'opaque'));
      if (aproveitavel) await guardar(cache, requisicao, resposta.clone());
      return resposta;
    }).catch(() => null);
    if (emCache) {
      evento.waitUntil(naRede);
      return emCache;
    }
    return (await naRede) || Response.error();
  })());
});
