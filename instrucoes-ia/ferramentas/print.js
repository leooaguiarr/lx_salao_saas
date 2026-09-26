// Print de uma tela com emulação real de celular, via Chrome DevTools Protocol.
// Sem dependências: usa o Chrome instalado e o WebSocket nativo do Node 22+.
//
// Uso:
//   node print.js <url> <saida.png> [largura] [--painel] [--aba=<nome>] [--claro]
//
//   --painel   esconde a tela de login e mostra o painel com os dados de
//              exemplo do HTML. Não faz login nem toca no banco: serve para
//              conferir LAYOUT, não comportamento.
//   --aba=X    abre a aba X do menu (dashboard, agenda, vendas, clientes...).
//   --claro    aplica o tema claro.
//   --js=ARQ   roda o arquivo JS na página antes do print, depois do --painel e
//              antes da --aba. Serve para pôr dados de exemplo na memória
//              (`data.appointments = [...]`) e ver a tela cheia sem tocar no
//              banco — o modelo dos testes da Alabama. Nunca chame saveData
//              nele: isso gravaria no banco de produção se houvesse sessão.
//
// Imprime a largura do viewport (vw) e os elementos que passam da borda.
// Em largura de celular, vw tem que ser igual à largura pedida.
//
// Por que não `chrome --window-size=390`: no Windows o headless tem piso de
// ~500px de janela e recorta a imagem, o que parece conteúdo vazando.

const { spawn } = require('child_process');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const args = process.argv.slice(2);
const flags = args.filter(a => a.startsWith('--'));
const [url, saida, largura = '390'] = args.filter(a => !a.startsWith('--'));
if (!url || !saida) {
  console.error('Uso: node print.js <url> <saida.png> [largura] [--painel] [--aba=<nome>] [--claro]');
  process.exit(1);
}

const LARGURA = Number(largura);
const ALTURA = LARGURA < 800 ? 844 : 900;
const CELULAR = LARGURA < 800;
const aba = (flags.find(f => f.startsWith('--aba=')) || '').slice(6);

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

const PORTA = 9400 + Math.floor(Math.random() * 500);
const perfil = path.join(os.tmpdir(), 'lexion-print-' + PORTA);
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

// Monta o painel sem login: as mesmas três coisas que o app faz ao entrar.
const MOSTRAR_PAINEL = `
  ['boot-overlay', 'auth-overlay'].forEach(id => { const el = document.getElementById(id); if (el) el.style.display = 'none'; });
  document.getElementById('app-container').style.display = 'flex';`;

const RELATORIO = `JSON.stringify({
  vw: innerWidth,
  altura: document.documentElement.scrollHeight,
  passamDaBorda: [...document.querySelectorAll('body *')]
    .map(el => [el, el.getBoundingClientRect()])
    .filter(([el, r]) => r.width > 0 && r.right > innerWidth + 1)
    .slice(0, 12)
    .map(([el, r]) => (el.id ? '#' + el.id : el.tagName.toLowerCase() + '.' + [...el.classList].join('.')) + ' → ' + Math.round(r.right) + 'px')
})`;

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
  const rodar = expr => cmd('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });

  await cmd('Emulation.setDeviceMetricsOverride', { width: LARGURA, height: ALTURA, deviceScaleFactor: 1, mobile: CELULAR });
  await cmd('Emulation.setTouchEmulationEnabled', { enabled: CELULAR });
  await cmd('Page.enable');
  await cmd('Runtime.enable');
  await cmd('Page.navigate', { url });
  await esperar(3500);

  if (flags.includes('--claro')) await rodar(`ThemeManager.applyMode('claro')`);
  if (flags.includes('--painel')) await rodar(MOSTRAR_PAINEL);
  const arquivoJs = (flags.find(f => f.startsWith('--js=')) || '').slice(5);
  if (arquivoJs) {
    const r = await rodar(fs.readFileSync(arquivoJs, 'utf8'));
    if (r.result.exceptionDetails) console.error('Erro no --js:', r.result.exceptionDetails.exception?.description);
  }
  if (aba) await rodar(`document.querySelector('.menu-item[data-target="${aba}"]')?.click()`);
  const subaba = (flags.find(f => f.startsWith('--subaba=')) || '').slice(9);
  if (subaba) await rodar(`document.querySelector('[data-config-tab="${subaba}"]')?.click()`);
  if (flags.includes('--recolher-menu')) await rodar(`document.getElementById('sidebar-collapse-btn')?.click()`);
  await esperar(800);

  console.log((await rodar(RELATORIO)).result.result.value);
  const print = await cmd('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(saida, Buffer.from(print.result.data, 'base64'));
  console.log('Salvo em ' + saida);

  ws.close();
  chrome.kill();
  process.exit(0);
})().catch(erro => { console.error(erro); chrome.kill(); process.exit(1); });
