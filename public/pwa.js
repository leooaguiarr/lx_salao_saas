// ============================================================
// APLICATIVO INSTALÁVEL (PWA)
// ============================================================
// O painel é um só sistema: no computador roda no navegador, no celular
// instala como aplicativo. Este arquivo cuida da parte "aplicativo":
//   - registra o service worker (sw.js), que é o que habilita a instalação;
//   - mostra "Instalar aplicativo" no menu quando o aparelho permite;
//   - acompanha a cor da barra de status do celular com o tema do painel.
//
// Só roda no painel. O link público de agendamento (/<slug>) usa o mesmo
// HTML, mas lá o index.html não injeta o manifest, e é por ele que este
// arquivo reconhece em qual das duas telas está.

(function () {
    const ehPainel = !!document.querySelector('link[rel="manifest"]');

    const instalado = () =>
        window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;

    // iPadOS se apresenta como Mac; o toque é o que o denuncia.
    const ehIOS = () =>
        /iphone|ipad|ipod/i.test(navigator.userAgent) ||
        (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

    /* ---------------------------------------------------- Cor da barra -- */

    // A barra de status do celular (e a barra de título do app instalado)
    // usa a theme-color. Sem acompanhar o tema, o salão de tema claro teria
    // uma faixa preta no topo da tela bege.
    function sincronizarCorDaBarra() {
        const meta = document.querySelector('meta[name="theme-color"]');
        if (!meta) return;
        const cor = getComputedStyle(document.documentElement).getPropertyValue('--background-primary').trim();
        if (cor) meta.setAttribute('content', cor);
    }
    sincronizarCorDaBarra();
    document.addEventListener('tema:alterado', sincronizarCorDaBarra);

    if (!ehPainel) return;

    /* ------------------------------------------------- Service worker -- */

    if ('serviceWorker' in navigator) {
        // Depois do load, para o cache inicial do SW não disputar banda com
        // o primeiro carregamento do painel.
        window.addEventListener('load', () => {
            navigator.serviceWorker.register('/sw.js').catch(err => {
                console.warn('[PWA] Service worker não registrado:', err);
            });
        });
    }

    /* ------------------------------------------------------ Instalação -- */

    const botao = document.getElementById('btn-instalar-app');
    let promptInstalacao = null;

    function atualizarBotao() {
        if (!botao) return;
        // Android/Chrome/Edge: só quando o navegador entregou o prompt.
        // iPhone: sempre que ainda não estiver instalado, porque lá a
        // instalação é manual e o navegador nunca avisa que ela é possível.
        botao.hidden = instalado() || !(promptInstalacao || ehIOS());
    }

    // O navegador avisa quando a instalação é possível; guardamos o evento
    // para disparar pelo nosso botão em vez da mini-barra automática.
    window.addEventListener('beforeinstallprompt', evento => {
        evento.preventDefault();
        promptInstalacao = evento;
        atualizarBotao();
    });

    window.addEventListener('appinstalled', () => {
        promptInstalacao = null;
        atualizarBotao();
        if (typeof showToast === 'function') showToast('Aplicativo instalado no aparelho.', 'success');
    });

    botao?.addEventListener('click', async () => {
        if (promptInstalacao) {
            promptInstalacao.prompt();
            await promptInstalacao.userChoice;
            // O evento só pode ser usado uma vez. Se a pessoa recusou, o
            // navegador manda outro mais tarde.
            promptInstalacao = null;
            atualizarBotao();
            return;
        }
        if (ehIOS() && typeof openModal === 'function') {
            document.getElementById('sidebar')?.classList.remove('show');
            openModal('modal-instalar-ios');
        }
    });

    atualizarBotao();
})();
