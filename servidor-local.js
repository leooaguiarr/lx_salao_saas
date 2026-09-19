/**
 * Servidor local para testar antes de subir para produção.
 *
 *   node servidor-local.js
 *
 * Serve a pasta public/ na porta 8099. Não precisa instalar nada — usa só o
 * que já vem no Node.
 *
 * Existe como arquivo, e não como comando de uma linha, porque o one-liner
 * equivalente quebra ao ser colado no PowerShell.
 *
 * ⚠️ O BANCO É O MESMO DE PRODUÇÃO. public/api.js aponta para o Supabase real
 * da barbearia nos dois casos. Testar aqui protege o CÓDIGO, não os DADOS:
 * um agendamento criado nesta tela entra na agenda real do Vagner.
 * Para testar comportamento sem tocar na base, use os scripts de testes/.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PORTA = Number(process.argv[2]) || 8099;
const RAIZ = path.join(__dirname, 'public');

const TIPOS = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.woff2': 'font/woff2',
};

const servidor = http.createServer((req, res) => {
    const caminho = decodeURIComponent(req.url.split('?')[0]);
    let arquivo = path.join(RAIZ, caminho === '/' ? 'index.html' : caminho);

    // Impede sair da pasta public/ por "../" na URL.
    if (!arquivo.startsWith(RAIZ)) {
        res.writeHead(403);
        return res.end('403');
    }

    fs.readFile(arquivo, (erro, conteudo) => {
        if (erro) {
            // Mesma regra do vercel.json: qualquer caminho desconhecido cai no
            // index.html, senão o link público /<slug> daria 404 aqui e
            // funcionaria em produção — a pior espécie de diferença.
            return fs.readFile(path.join(RAIZ, 'index.html'), (e2, html) => {
                if (e2) { res.writeHead(404); return res.end('404'); }
                res.writeHead(200, { 'Content-Type': TIPOS['.html'] });
                res.end(html);
            });
        }
        res.writeHead(200, {
            'Content-Type': TIPOS[path.extname(arquivo)] || 'application/octet-stream',
            // Sem cache: senão uma alteração no CSS não aparece ao recarregar
            // e se perde tempo procurando bug que não existe.
            'Cache-Control': 'no-store',
        });
        res.end(conteudo);
    });
});

function ipDaRede() {
    const redes = os.networkInterfaces();
    for (const nome of Object.keys(redes)) {
        for (const rede of redes[nome] || []) {
            if (rede.family === 'IPv4' && !rede.internal) return rede.address;
        }
    }
    return null;
}

servidor.on('error', (erro) => {
    if (erro.code === 'EADDRINUSE') {
        console.error(`\n  A porta ${PORTA} já está em uso.`);
        console.error('  Feche o servidor que está rodando, ou escolha outra porta:');
        console.error(`      node servidor-local.js 8100\n`);
        process.exit(1);
    }
    throw erro;
});

// 0.0.0.0 de propósito: é o que permite abrir no CELULAR, pela mesma rede
// Wi-Fi. O sistema é usado no celular — testar só no computador esconde
// justamente os problemas que mais aparecem.
servidor.listen(PORTA, '0.0.0.0', () => {
    const ip = ipDaRede();
    console.log('\n  Servidor local no ar. Ctrl+C para parar.\n');
    console.log(`  Sistema .............. http://localhost:${PORTA}`);
    console.log(`  Link de agendamento .. http://localhost:${PORTA}/agendamento`);
    if (ip) {
        console.log(`\n  No celular (mesma rede Wi-Fi):`);
        console.log(`  Sistema .............. http://${ip}:${PORTA}`);
        console.log(`  Link de agendamento .. http://${ip}:${PORTA}/agendamento`);
    }
    console.log('\n  ⚠️  O banco é o MESMO de produção: o que for cadastrado aqui');
    console.log('     entra na agenda real da barbearia.\n');
});
