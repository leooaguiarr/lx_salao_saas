// Teste da PWA via Chrome DevTools Protocol, sem dependências.
//
// Confere o manifest, se o painel é instalável, o service worker, a barra de
// abas no celular, se o painel ABRE COM A REDE DESLIGADA (com o cache HTTP do
// navegador desligado também, para provar que quem serve é o service worker)
// e se o link público de agendamento fica sem manifest.
//
// Uso (com o servidor rodando em outro terminal):
//   node pwa-test.js                                   # http://localhost:8000
//   node pwa-test.js https://salao.lexionconsultoria.tech

const { spawn } = require('child_process');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const ALVO = (process.argv[2] || 'http://localhost:8000').replace(/\/$/, '');

const CANDIDATOS = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  (process.env.LOCALAPPDATA || '') + '/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
].filter(Boolean);
const CHROME = CANDIDATOS.find(caminho => fs.existsSync(caminho));
if (!CHROME) {
  console.error('Chrome não encontrado. Defina CHROME_PATH com o caminho do executável.');
  process.exit(1);
}

const PORTA = 9555;
// Perfil novo a cada execução: com um perfil reaproveitado, o service worker
// da rodada anterior já estaria instalado e o teste provaria menos.
const perfil = path.join(os.tmpdir(), 'lexion-pwa-' + Date.now());
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-first-run',
  '--remote-debugging-port=' + PORTA, '--user-data-dir=' + perfil, 'about:blank'], { stdio: 'ignore' });

const esperar = ms => new Promise(r => setTimeout(r, ms));
const pegarJSON = caminho => new Promise((resolve, reject) => {
  http.get({ host: '127.0.0.1', port: PORTA, path: caminho }, res => {
    let corpo = '';
    res.on('data', c => corpo += c);
    res.on('end', () => { try { resolve(JSON.parse(corpo)); } catch (e) { reject(e); } });
  }).on('error', reject);
});

const falhas = [];
const conferir = (ok, msg) => {
  console.log((ok ? '  ✔ ' : '  ✘ ') + msg);
  if (!ok) falhas.push(msg);
};

(async () => {
  let alvos;
  for (let i = 0; i < 40 && !alvos; i++) {
    try { alvos = await pegarJSON('/json'); } catch { await esperar(250); }
  }
  const ws = new WebSocket(alvos.find(a => a.type === 'page').webSocketDebuggerUrl);
  await new Promise(r => ws.onopen = r);
  let id = 0;
  const pendentes = {};
  ws.onmessage = m => {
    const d = JSON.parse(m.data);
    if (d.id && pendentes[d.id]) { pendentes[d.id](d); delete pendentes[d.id]; }
  };
  const cmd = (method, params = {}) => new Promise(r => {
    const i = ++id; pendentes[i] = r; ws.send(JSON.stringify({ id: i, method, params }));
  });
  const avaliar = async expr =>
    (await cmd('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result.result.value;

  await cmd('Page.enable');
  await cmd('Runtime.enable');
  await cmd('Network.enable');
  await cmd('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });

  console.log(`Painel (${ALVO}/app):`);
  await cmd('Page.navigate', { url: ALVO + '/app' });
  await esperar(5000);

  const manifest = (await cmd('Page.getAppManifest')).result || {};
  conferir(manifest.url && manifest.url.endsWith('/manifest.webmanifest'), 'manifest encontrado');
  conferir(!(manifest.errors || []).length, 'manifest sem erros ' + JSON.stringify(manifest.errors || []));

  const instalacao = (await cmd('Page.getInstallabilityErrors')).result || {};
  const erros = instalacao.installabilityErrors || [];
  conferir(erros.length === 0, 'instalável' + (erros.length ? ' ' + JSON.stringify(erros) : ''));

  const sw = await avaliar(`navigator.serviceWorker.getRegistration()
    .then(r => r ? (r.active ? 'ativo' : 'instalando') : 'nenhum')`);
  conferir(sw === 'ativo', 'service worker: ' + sw);
  console.log('    cache: ' + await avaliar(`caches.keys().then(async nomes => {
    let n = 0;
    for (const nome of nomes) n += (await (await caches.open(nome)).keys()).length;
    return nomes.join(', ') + ' / ' + n + ' itens';
  })`));

  conferir(await avaliar(`getComputedStyle(document.getElementById('mobile-tab-bar')).display === 'flex'`),
    'barra de abas visível a 390px');
  conferir(await avaliar(`innerWidth === 390`), 'página sem transbordo horizontal (vw = 390)');

  console.log('Sem internet:');
  await cmd('Network.setCacheDisabled', { cacheDisabled: true });
  await cmd('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  await cmd('Page.reload');
  await esperar(5000);
  conferir(await avaliar(`!!document.getElementById('app-container')`), 'painel abre offline');
  conferir(await avaliar(`[...document.styleSheets].some(s => (s.href || '').includes('index.css') && s.cssRules.length > 100)`),
    'CSS do painel carregado offline');
  conferir(await avaliar(`document.fonts.load('900 16px "Font Awesome 6 Free"').then(f => f.length > 0)`),
    'ícones (Font Awesome) offline');
  conferir(await avaliar(`document.fonts.load('700 16px "Plus Jakarta Sans"').then(f => f.length > 0)`),
    'fonte Plus Jakarta Sans offline');
  await cmd('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });

  console.log('Link público (/salao-teste):');
  await cmd('Page.navigate', { url: ALVO + '/salao-teste' });
  await esperar(3500);
  conferir(await avaliar(`!document.querySelector('link[rel="manifest"]')`), 'sem manifest no link público');
  // Confere a tela, não o atributo: um `display` no CSS vence o [hidden] e o
  // botão aparecia com hidden = true.
  conferir(await avaliar(`getComputedStyle(document.getElementById('btn-instalar-app')).display === 'none'`),
    'botão de instalar escondido');

  ws.close();
  chrome.kill();
  console.log(falhas.length ? `\n${falhas.length} falha(s)` : '\nTudo certo');
  process.exit(falhas.length ? 1 : 0);
})().catch(erro => { console.error(erro); chrome.kill(); process.exit(1); });
