/**
 * ==========================================================================
 * ENCAIXE — "CHEGOU AGORA"
 *
 * O cliente que chega sem hora marcada. Cadastro rápido e encaixe no primeiro
 * horário livre do dia, entre todos os profissionais ativos.
 *
 * A regra de "que horário está livre" NÃO mora aqui — é a mesma do link
 * público, em gradeDoProfissional()/primeiroHorarioLivre() (BASE DE CÁLCULO DA
 * DISPONIBILIDADE, em app.js). A diferença é só a antecedência: o link exige
 * 2h porque o cliente ainda vai se deslocar; aqui é 0, a pessoa já está de pé
 * na recepção.
 *
 * Carregado por <script> em index.html, DEPOIS de app.js. Tudo compartilha o
 * mesmo escopo global — não há módulos nem build.
 * ==========================================================================
 */

// Guarda a vaga encontrada entre a busca e a confirmação. Fica em variável, e
// não só no HTML, porque o campo escondido é reescrito a cada digitação do
// nome e já se perdeu uma vez nesse caminho.
let encaixeVaga = null;

// O painel de "pronto" reescreve o corpo e o rodapé do modal. Sem guardar o
// formulário original, a segunda abertura acharia os campos destruídos e
// quebraria no primeiro getElementById.
let encaixeFormularioHTML = null;

function restaurarFormularioDoEncaixe() {
    const corpo = document.querySelector('#modal-encaixe .modal-body');
    const rodape = document.querySelector('#modal-encaixe .modal-footer');
    if (!corpo || !rodape) return;

    if (encaixeFormularioHTML === null) {
        encaixeFormularioHTML = { corpo: corpo.innerHTML, rodape: rodape.innerHTML };
        return;
    }
    corpo.innerHTML = encaixeFormularioHTML.corpo;
    rodape.innerHTML = encaixeFormularioHTML.rodape;
    // Os listeners foram registrados nos elementos antigos, que acabaram de ser
    // descartados junto com o innerHTML.
    document.getElementById('encaixe-servico')?.addEventListener('change', buscarVagaDoEncaixe);
    document.getElementById('encaixe-prof')?.addEventListener('change', buscarVagaDoEncaixe);
    document.getElementById('encaixe-nome')?.addEventListener('input', sugerirClientesDoEncaixe);
}

window.abrirEncaixe = function () {
    restaurarFormularioDoEncaixe();
    const select = document.getElementById('encaixe-servico');
    const ativos = (data.services || []).filter(s => s.active);

    if (!ativos.length) {
        showToast('Cadastre ao menos um serviço ativo antes de encaixar.', 'warning');
        return;
    }
    if (!(data.professionals || []).some(p => p.active)) {
        showToast('Cadastre ao menos um profissional ativo antes de encaixar.', 'warning');
        return;
    }

    select.innerHTML = ativos.map(s =>
        `<option value="${escapeHTML(s.id)}">${escapeHTML(s.name)} · ${s.duration}min · ${formatCurrency(s.price)}</option>`
    ).join('');

    // Preenche lista de profissionais ativos
    const selectProf = document.getElementById('encaixe-prof');
    if (selectProf) {
        const profsAtivos = (data.professionals || []).filter(p => p.active);
        selectProf.innerHTML = '<option value="">Qualquer profissional (Mais rápido)</option>' +
            profsAtivos.map(p => `<option value="${escapeHTML(p.id)}">${escapeHTML(p.name)}</option>`).join('');

        // Se for barbeiro logado, pré-seleciona ele mesmo
        if (typeof DataService !== 'undefined' && DataService.ehBarbeiro && DataService.ehBarbeiro()) {
            const meuId = DataService.getProfissionalDoLogin ? DataService.getProfissionalDoLogin() : null;
            if (meuId && profsAtivos.some(p => p.id === meuId)) {
                selectProf.value = meuId;
            }
        }
    }

    ['encaixe-nome', 'encaixe-phone', 'encaixe-client-id', 'encaixe-prof-id', 'encaixe-hora']
        .forEach(id => { document.getElementById(id).value = ''; });
    document.getElementById('encaixe-sugestoes').innerHTML = '';
    encaixeVaga = null;

    buscarVagaDoEncaixe();
    openModal('modal-encaixe');
    // Foco no nome, não no serviço: o serviço já vem com o primeiro escolhido
    // e a pessoa no balcão começa perguntando o nome.
    setTimeout(() => document.getElementById('encaixe-nome').focus(), 120);
};

/* Procura a vaga e desenha o resultado. Roda a cada troca de serviço ou profissional
   porque a duração e a escala do barbeiro mudam o que cabe. */
function buscarVagaDoEncaixe() {
    const alvo = document.getElementById('encaixe-vaga');
    const botao = document.getElementById('btn-encaixe-confirmar');
    const servico = (data.services || []).find(s => s.id === document.getElementById('encaixe-servico')?.value);
    const profEscolhidoId = document.getElementById('encaixe-prof')?.value || '';
    const hoje = getLocalDateString(new Date());

    if (!servico) {
        encaixeVaga = null;
        if (alvo) alvo.innerHTML = '';
        if (botao) botao.disabled = true;
        return;
    }

    if (profEscolhidoId) {
        const profObj = (data.professionals || []).find(p => p.id === profEscolhidoId);
        const profNome = profObj ? profObj.name : 'o profissional';

        // 1. Tenta achar vaga especificamente para o profissional escolhido
        const vagaDoProf = primeiroHorarioLivre(hoje, servico.duration, { antecedenciaMin: 0, profId: profEscolhidoId });

        if (vagaDoProf) {
            encaixeVaga = vagaDoProf;
            alvo.innerHTML = `
                <div class="encaixe-vaga">
                    <span class="encaixe-vaga-rotulo">Encaixe em</span>
                    <strong class="encaixe-vaga-hora">${escapeHTML(encaixeVaga.time)}</strong>
                    <span class="encaixe-vaga-prof">com ${escapeHTML(encaixeVaga.profNome)}</span>
                </div>`;
            botao.disabled = false;
            document.getElementById('encaixe-prof-id').value = encaixeVaga.profId;
            document.getElementById('encaixe-hora').value = encaixeVaga.time;
            return;
        }

        // 2. Se o escolhido não tem vaga, busca o próximo livre entre os outros da equipe
        const vagaAlternativa = primeiroHorarioLivre(hoje, servico.duration, { antecedenciaMin: 0 });

        if (vagaAlternativa) {
            encaixeVaga = vagaAlternativa;
            alvo.innerHTML = `
                <div class="encaixe-vaga encaixe-vaga-sugerida">
                    <div class="encaixe-aviso-indisponivel">
                        <i class="fa-solid fa-triangle-exclamation"></i>
                        <span><strong>${escapeHTML(profNome)}</strong> sem horário livre hoje.</span>
                    </div>
                    <div class="encaixe-vaga-detalhe">
                        <span class="encaixe-vaga-rotulo">Próximo disponível:</span>
                        <strong class="encaixe-vaga-hora">${escapeHTML(vagaAlternativa.time)}</strong>
                        <span class="encaixe-vaga-prof">com ${escapeHTML(vagaAlternativa.profNome)}</span>
                    </div>
                </div>`;
            botao.disabled = false;
            document.getElementById('encaixe-prof-id').value = vagaAlternativa.profId;
            document.getElementById('encaixe-hora').value = vagaAlternativa.time;
            return;
        }

        // 3. Nenhum profissional tem vaga
        encaixeVaga = null;
        alvo.innerHTML = `
            <div class="encaixe-sem-vaga">
                <i class="fa-solid fa-circle-exclamation"></i>
                Sem horário livre hoje para este serviço com nenhum profissional.
            </div>`;
        botao.disabled = true;
        document.getElementById('encaixe-prof-id').value = '';
        document.getElementById('encaixe-hora').value = '';
        return;
    }

    // Modo automático: pega o primeiro horário livre entre todos
    encaixeVaga = primeiroHorarioLivre(hoje, servico.duration, { antecedenciaMin: 0 });

    if (!encaixeVaga) {
        alvo.innerHTML = `
            <div class="encaixe-sem-vaga">
                <i class="fa-solid fa-circle-exclamation"></i>
                Sem horário livre hoje para este serviço. Ofereça agendamento para outro dia.
            </div>`;
        botao.disabled = true;
        document.getElementById('encaixe-prof-id').value = '';
        document.getElementById('encaixe-hora').value = '';
        return;
    }

    alvo.innerHTML = `
        <div class="encaixe-vaga">
            <span class="encaixe-vaga-rotulo">Encaixe em</span>
            <strong class="encaixe-vaga-hora">${escapeHTML(encaixeVaga.time)}</strong>
            <span class="encaixe-vaga-prof">com ${escapeHTML(encaixeVaga.profNome)}</span>
        </div>`;
    botao.disabled = false;
    document.getElementById('encaixe-prof-id').value = encaixeVaga.profId;
    document.getElementById('encaixe-hora').value = encaixeVaga.time;
}

/* Cliente que já veio antes não deve virar cadastro novo: duplicata quebra o
   histórico, a frequência de retorno e a busca pelo WhatsApp na fila. */
function sugerirClientesDoEncaixe() {
    const termo = sanitizePlainText(document.getElementById('encaixe-nome').value).toLowerCase();
    const caixa = document.getElementById('encaixe-sugestoes');
    document.getElementById('encaixe-client-id').value = '';

    if (termo.length < 3) { caixa.innerHTML = ''; return; }

    const achados = (data.clients || [])
        .filter(c => (c.name || '').toLowerCase().includes(termo))
        .slice(0, 4);

    caixa.innerHTML = achados.map(c => `
        <button type="button" class="encaixe-sugestao" onclick="usarClienteNoEncaixe('${escapeHTML(c.id)}')">
            <i class="fa-regular fa-user"></i> ${escapeHTML(c.name)}
            <span>${escapeHTML(c.phone || '')}</span>
        </button>`).join('');
}

window.usarClienteNoEncaixe = function (clientId) {
    const cli = (data.clients || []).find(c => c.id === clientId);
    if (!cli) return;
    document.getElementById('encaixe-client-id').value = cli.id;
    document.getElementById('encaixe-nome').value = cli.name;
    document.getElementById('encaixe-phone').value = cli.phone || '';
    document.getElementById('encaixe-sugestoes').innerHTML = '';
};

window.confirmarEncaixe = function (event) {
    if (event) event.preventDefault();

    const nome = sanitizePlainText(document.getElementById('encaixe-nome').value);
    const phone = sanitizePlainText(document.getElementById('encaixe-phone').value);
    const serviceId = document.getElementById('encaixe-servico').value;

    if (!nome || !phone) {
        showToast('Preencha o nome e o WhatsApp.', 'warning');
        return;
    }
    // Revalida na confirmação: entre abrir o modal e digitar o nome, outro
    // encaixe pode ter tomado a vaga.
    buscarVagaDoEncaixe();
    if (!encaixeVaga) {
        showToast('A vaga foi ocupada. Confira o novo horário.', 'warning');
        return;
    }

    let clientId = document.getElementById('encaixe-client-id').value;
    if (!clientId) {
        // Telefone é a chave de quem já existe: é por ele que a fila encontra
        // o cliente, e é o que o link público também usa.
        const jaExiste = (data.clients || []).find(c => c.phone === phone);
        if (jaExiste) {
            clientId = jaExiste.id;
        } else {
            clientId = 'cli-' + Date.now();
            data.clients.push({
                id: clientId, name: nome, phone: phone, instagram: '', birth: '',
                frequency: 30, lastVisit: getLocalDateString(new Date()),
                notes: 'Cadastrado no balcão, por encaixe.',
                loyaltyEnrolled: true
            });
            saveData(STATE_KEYS.CLIENTS, data.clients);
        }
    }

    const appt = {
        id: 'appt-' + Date.now(),
        clientId: clientId,
        serviceId: serviceId,
        profId: encaixeVaga.profId,
        date: getLocalDateString(new Date()),
        time: encaixeVaga.time,
        // 'confirmed' e não 'scheduled': o cliente está na sala, não há o que
        // confirmar depois.
        status: 'confirmed',
        paymentStatus: 'pending',
        notes: 'Encaixe — cliente chegou sem hora marcada.'
    };
    data.appointments.push(appt);
    saveData(STATE_KEYS.APPOINTMENTS, data.appointments);

    renderDashboard();
    if (typeof renderAgenda === 'function') renderAgenda();
    if (typeof renderClients === 'function') renderClients();

    mostrarEncaixeFeito(nome, phone, encaixeVaga);
};

/* Confirmado: o modal vira o painel de "pronto", com o WhatsApp à mão.
   O toast não serve para isto — ele sanitiza HTML, some em 4s e não comporta
   um botão. E abrir o WhatsApp sozinho jogaria uma janela por cima da
   recepção no meio do atendimento; quem decide enviar é o atendente. */
function mostrarEncaixeFeito(nome, phone, vaga) {
    const corpo = document.querySelector('#modal-encaixe .modal-body');
    const rodape = document.querySelector('#modal-encaixe .modal-footer');
    const slug = (data.businessInfo && data.businessInfo.slug) || '';
    const primeiro = primeiroNomeApresentavel(nome);

    corpo.innerHTML = `
        <div class="encaixe-feito">
            <i class="fa-solid fa-circle-check"></i>
            <p class="encaixe-feito-titulo">${escapeHTML(primeiro)} está na fila</p>
            <p class="encaixe-feito-detalhe">
                <strong>${escapeHTML(vaga.time)}</strong> com ${escapeHTML(vaga.profNome)}
            </p>
        </div>`;

    if (slug) {
        // Sem escapeHTML no texto da mensagem: ele vai para a URL do WhatsApp,
        // e escapar transformaria "&" em "&amp;" na mensagem enviada.
        const link = getPublicBookingUrl(slug);
        const texto = `Olá ${primeiro}! Você está encaixado às ${vaga.time} com ${vaga.profNome}. ` +
            `Acompanhe a sua vez em ${link}`;
        const url = `https://wa.me/55${phone.replace(/\D/g, '')}?text=${encodeURIComponent(texto)}`;
        rodape.innerHTML = `
            <button type="button" class="btn btn-secondary" data-close-modal="modal-encaixe" onclick="closeModal('modal-encaixe')">Fechar</button>
            <a class="btn btn-success" href="${escapeHTML(url)}" target="_blank" rel="noopener noreferrer">
                <i class="fa-brands fa-whatsapp"></i> Enviar link da fila
            </a>`;
    } else {
        rodape.innerHTML = `
            <button type="button" class="btn btn-primary" data-close-modal="modal-encaixe" onclick="closeModal('modal-encaixe')">Fechar</button>`;
    }

    showToast(`${primeiro} encaixado às ${vaga.time} com ${vaga.profNome}.`, 'success');
}

document.getElementById('form-encaixe')?.addEventListener('submit', confirmarEncaixe);
document.getElementById('encaixe-servico')?.addEventListener('change', buscarVagaDoEncaixe);
document.getElementById('encaixe-prof')?.addEventListener('change', buscarVagaDoEncaixe);
document.getElementById('encaixe-nome')?.addEventListener('input', sugerirClientesDoEncaixe);

