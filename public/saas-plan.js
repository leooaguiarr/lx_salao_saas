/**
 * SaaS Plan Gatekeeper & Feature Locks
 * Controla os limites de plano:
 * - Plano Individual: 1 profissional, agendamento, clientes, vendas básicas (sem estoque e fidelidade)
 * - Plano Equipe: até 4 profissionais, estoque liberado
 * - Plano Ilimitado: profissionais ilimitados, fidelidade e crediário liberados
 */

const SaaSPlanManager = {
    currentPlanId: 'individual',
    subscriptionStatus: 'trial', // 'trial', 'active', 'past_due', 'canceled'
    trialEndsAt: null,
    
    init(businessInfo) {
        if (!businessInfo) return;

        this.currentPlanId = businessInfo.plan_id || businessInfo.planId || 'individual';
        this.subscriptionStatus = businessInfo.status || 'trial';
        this.trialEndsAt = businessInfo.trial_ends_at || businessInfo.trialEndsAt || null;

        this.applyPlanRestrictions();
        this.renderSubscriptionBanner();
    },

    getPlan() {
        const plans = (window.APP_CONFIG && window.APP_CONFIG.PLANS) || {};
        return plans[this.currentPlanId] || plans.individual;
    },

    canAccess(feature) {
        const plan = this.getPlan();
        if (!plan || !plan.features) return true;
        return !!plan.features[feature];
    },

    getMaxProfessionals() {
        const plan = this.getPlan();
        return plan ? plan.maxProfessionals : 1;
    },

    /**
     * Aplica visualmente as travas na barra lateral / abas do sistema
     */
    applyPlanRestrictions() {
        const plan = this.getPlan();

        // Trava da aba Estoque
        const tabEstoque = document.querySelector('[data-target="estoque"], [data-tab="estoque"]');
        if (tabEstoque) {
            if (!this.canAccess('inventory')) {
                this.decorateLockedTab(tabEstoque, 'Estoque', 'equipe_4');
            } else {
                this.removeLockFromTab(tabEstoque);
            }
        }

        // Trava da aba Fidelidade
        const tabFidelidade = document.querySelector('[data-target="fidelidade"], [data-tab="fidelidade"]');
        if (tabFidelidade) {
            if (!this.canAccess('loyalty')) {
                this.decorateLockedTab(tabFidelidade, 'Clube de Benefícios', 'ilimitado');
            } else {
                this.removeLockFromTab(tabFidelidade);
            }
        }

        // Trava da aba Crediário
        const tabCrediario = document.querySelector('[data-target="crediario"], [data-tab="crediario"]');
        if (tabCrediario) {
            if (!this.canAccess('credit')) {
                this.decorateLockedTab(tabCrediario, 'Crediário', 'ilimitado');
            } else {
                this.removeLockFromTab(tabCrediario);
            }
        }
    },

    decorateLockedTab(tabElement, featureName, requiredPlan) {
        if (tabElement.dataset.isLocked) return;

        tabElement.dataset.isLocked = 'true';
        let badge = tabElement.querySelector('.plan-lock-badge');
        if (!badge) {
            badge = document.createElement('span');
            badge.className = 'plan-lock-badge';
            badge.innerHTML = '<i class="fa-solid fa-lock"></i> PRO';
            // A aparência mora no index.css (.plan-lock-badge), com as cores
            // do tema. O dourado fixo que havia aqui destoava de oito temas.
            tabElement.appendChild(badge);
        }

        // Intercepta clique para mostrar modal de upgrade
        tabElement.addEventListener('click', (e) => {
            if (tabElement.dataset.isLocked === 'true') {
                e.stopImmediatePropagation();
                e.preventDefault();
                this.showUpgradeModal(featureName, requiredPlan);
            }
        }, true);
    },

    removeLockFromTab(tabElement) {
        tabElement.dataset.isLocked = 'false';
        const badge = tabElement.querySelector('.plan-lock-badge');
        if (badge) badge.remove();
    },

    /**
     * Valida se pode cadastrar mais um profissional
     */
    checkCanAddProfessional(currentCount) {
        const max = this.getMaxProfessionals();
        if (currentCount >= max) {
            const nextPlan = max === 1 ? 'equipe_4' : 'ilimitado';
            this.showUpgradeModal(
                `Cadastro de Profissionais (Limite atingido: ${max})`,
                nextPlan,
                `Seu plano atual (${this.getPlan().name}) permite até ${max} profissional(is). Faça upgrade para adicionar mais membros à sua equipe.`
            );
            return false;
        }
        return true;
    },

    /**
     * Exibe o modal de Upgrade de Plano
     */
    showUpgradeModal(featureName, requiredPlanId, customMessage) {
        let modal = document.getElementById('modal-upgrade-saas');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'modal-upgrade-saas';
            modal.className = 'modal-backdrop';
            modal.innerHTML = `
                <div class="modal-dialog glass-effect" style="max-width: 480px; text-align: center; padding: 28px;">
                    <div style="width: 60px; height: 60px; border-radius: 50%; background: var(--primary-light); border: 1px solid var(--primary-edge); display: flex; align-items: center; justify-content: center; margin: 0 auto 16px; font-size: 1.6rem; color: var(--primary);">
                        <i class="fa-solid fa-crown"></i>
                    </div>
                    <h3 id="upgrade-modal-title" style="margin-bottom: 8px; font-size: 1.3rem;">Recurso Exclusivo</h3>
                    <p id="upgrade-modal-desc" style="color: var(--text-muted); font-size: 0.92rem; line-height: 1.5; margin-bottom: 24px;"></p>
                    <div style="background: var(--surface-hover); border: 1px solid var(--border-color); border-radius: 12px; padding: 16px; margin-bottom: 24px; text-align: left;">
                        <div style="font-weight: 600; font-size: 0.95rem; margin-bottom: 6px; color: var(--text-main);" id="upgrade-modal-plan-name">Plano Recomendado</div>
                        <div style="font-size: 0.85rem; color: var(--text-muted);" id="upgrade-modal-plan-features">Libere este recurso e potencialize seu faturamento.</div>
                    </div>
                    <div style="display: flex; gap: 12px;">
                        <button type="button" class="btn btn-secondary" style="flex: 1;" onclick="const m = document.getElementById('modal-upgrade-saas'); if (m) { m.classList.remove('show'); m.classList.remove('active'); }">Voltar</button>
                        <button type="button" class="btn btn-primary" style="flex: 1.5;" onclick="SaaSPlanManager.redirectToCheckout()">Fazer Upgrade</button>
                    </div>
                </div>
            `;
            document.body.appendChild(modal);
        }

        const plans = (window.APP_CONFIG && window.APP_CONFIG.PLANS) || {};
        const targetPlan = plans[requiredPlanId] || plans.equipe_4;

        document.getElementById('upgrade-modal-title').textContent = `Liberar ${featureName}`;
        document.getElementById('upgrade-modal-desc').textContent = customMessage || 
            `O recurso "${featureName}" está disponível a partir do ${targetPlan.name}. Faça o upgrade instantâneo para liberar agora mesmo.`;
        document.getElementById('upgrade-modal-plan-name').textContent = `${targetPlan.name} • R$ ${targetPlan.price.toFixed(2).replace('.', ',')}/mês`;

        modal.classList.add('show');
        modal.classList.add('active');
    },

    redirectToCheckout(planId) {
        const modal = document.getElementById('modal-upgrade-saas');
        if (modal) {
            modal.classList.remove('show');
            modal.classList.remove('active');
        }
        this.showCheckoutModal(planId || this.currentPlanId);
    },

    showCheckoutModal(defaultPlanId) {
        let modal = document.getElementById('modal-asaas-checkout');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'modal-asaas-checkout';
            modal.className = 'modal-backdrop';
            modal.innerHTML = `
                <div class="modal-dialog glass-effect" style="max-width: 520px; text-align: left; padding: 28px; position: relative; border: 1px solid var(--primary-edge); border-radius: 16px; background: var(--bg-tertiary); color: var(--text-main); z-index: 100001;">
                    <button type="button" onclick="const m = document.getElementById('modal-asaas-checkout'); if (m) { m.classList.remove('show'); m.classList.remove('active'); }" style="position: absolute; top: 16px; right: 18px; background: none; border: none; font-size: 1.5rem; color: var(--text-muted); cursor: pointer;">&times;</button>
                    
                    <div id="checkout-form-step">
                        <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 20px;">
                            <div style="width: 44px; height: 44px; border-radius: 10px; background: var(--primary-light); color: var(--primary); display: flex; align-items: center; justify-content: center; font-size: 1.2rem; border: 1px solid var(--primary-edge);">
                                <i class="fa-solid fa-shield-halved"></i>
                            </div>
                            <div>
                                <h3 style="font-size: 1.25rem; font-weight: 700; margin: 0; color: var(--text-main);">Assinatura do Salão</h3>
                                <p style="font-size: 0.84rem; color: var(--text-muted); margin: 2px 0 0 0;">Gateway Oficial Asaas • Ativação Imediata</p>
                            </div>
                        </div>

                        <form id="form-asaas-checkout" onsubmit="SaaSPlanManager.processCheckout(event)">
                            <div style="margin-bottom: 14px;">
                                <label style="display: block; font-size: 0.82rem; font-weight: 600; margin-bottom: 6px; color: var(--primary);">Plano Selecionado</label>
                                <select id="checkout-plan-select" style="width: 100%; padding: 10px 12px; background: var(--bg-primary); border: 1px solid var(--border-strong); border-radius: 8px; color: var(--text-main); font-size: 0.9rem;">
                                    <option value="individual">Plano Solo / Individual — R$ 59,90/mês</option>
                                    <option value="equipe_4">Plano Equipe (Até 4) — R$ 119,90/mês ⭐</option>
                                    <option value="ilimitado">Plano Ilimitado Premium — R$ 199,90/mês</option>
                                </select>
                            </div>

                            <div style="margin-bottom: 14px;">
                                <label style="display: block; font-size: 0.82rem; font-weight: 600; margin-bottom: 6px; color: var(--text-muted);">Nome Completo / Razão Social</label>
                                <input type="text" id="checkout-name" required placeholder="Seu nome completo" style="width: 100%; padding: 10px 12px; background: var(--bg-primary); border: 1px solid var(--border-strong); border-radius: 8px; color: var(--text-main); font-size: 0.9rem;" />
                            </div>

                            <div style="display: grid; grid-template-columns: 1.2fr 1fr; gap: 12px; margin-bottom: 14px;">
                                <div>
                                    <label style="display: block; font-size: 0.82rem; font-weight: 600; margin-bottom: 6px; color: var(--text-muted);">CPF ou CNPJ</label>
                                    <input type="text" id="checkout-cpf" required placeholder="000.000.000-00" style="width: 100%; padding: 10px 12px; background: var(--bg-primary); border: 1px solid var(--border-strong); border-radius: 8px; color: var(--text-main); font-size: 0.9rem;" />
                                </div>
                                <div>
                                    <label style="display: block; font-size: 0.82rem; font-weight: 600; margin-bottom: 6px; color: var(--text-muted);">WhatsApp / Tel</label>
                                    <input type="tel" id="checkout-phone" required placeholder="(11) 98888-7777" style="width: 100%; padding: 10px 12px; background: var(--bg-primary); border: 1px solid var(--border-strong); border-radius: 8px; color: var(--text-main); font-size: 0.9rem;" />
                                </div>
                            </div>

                            <div style="margin-bottom: 20px; background: var(--primary-soft); border: 1px solid var(--primary-edge); border-radius: 10px; padding: 12px;">
                                <div style="display: flex; align-items: center; gap: 8px; font-weight: 600; font-size: 0.88rem; color: var(--primary); margin-bottom: 4px;">
                                    <i class="fa-brands fa-pix"></i> Pagamento Recorrente via Pix
                                </div>
                                <div style="font-size: 0.8rem; color: var(--text-muted); line-height: 1.4;">
                                    Será gerado um QR Code Pix instantâneo. A confirmação do Asaas ativa sua assinatura automaticamente sem intervenção manual.
                                </div>
                            </div>

                            <div id="checkout-error" style="display: none; background: var(--danger-light); border: 1px solid var(--danger); color: var(--danger); padding: 10px 14px; border-radius: 8px; font-size: 0.85rem; margin-bottom: 14px;">
                                <span></span>
                            </div>

                            <button type="submit" id="btn-submit-checkout" style="width: 100%; padding: 12px; background: var(--primary-gradient); color: var(--text-accent-gold); font-weight: 700; border: none; border-radius: 8px; font-size: 0.95rem; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 8px;">
                                <i class="fa-solid fa-lock"></i> Gerar Assinatura & Pix Asaas
                            </button>
                        </form>
                    </div>

                    <div id="checkout-pix-step" style="display: none; text-align: center;">
                        <div style="width: 50px; height: 50px; border-radius: 50%; background: var(--success-light); color: var(--success); display: flex; align-items: center; justify-content: center; font-size: 1.4rem; margin: 0 auto 12px;">
                            <i class="fa-solid fa-check"></i>
                        </div>
                        <h4 style="font-size: 1.2rem; font-weight: 700; margin-bottom: 4px;">Cobrança Pix Gerada!</h4>
                        <p style="font-size: 0.85rem; color: var(--text-muted); margin-bottom: 16px;">Abra o app do seu banco e escaneie o QR Code abaixo:</p>

                        <div id="checkout-pix-qr-container" style="margin-bottom: 16px;"></div>

                        <div style="margin-bottom: 16px; text-align: left;">
                            <label style="display: block; font-size: 0.78rem; font-weight: 600; color: var(--text-muted); margin-bottom: 4px;">Ou copie o código Pix Copia e Cola:</label>
                            <div style="display: flex; gap: 8px;">
                                <input type="text" id="checkout-pix-code" readonly style="flex: 1; padding: 8px 10px; background: var(--bg-primary); border: 1px solid var(--border-strong); border-radius: 6px; color: var(--primary); font-size: 0.8rem; font-family: monospace;" />
                                <button type="button" onclick="SaaSPlanManager.copyPixCode()" style="background: var(--surface-strong); border: 1px solid var(--border-strong); color: var(--text-main); padding: 8px 12px; border-radius: 6px; cursor: pointer; font-size: 0.8rem; font-weight: 600;">Copiar</button>
                            </div>
                        </div>

                        <p style="font-size: 0.8rem; color: var(--text-muted); margin-bottom: 16px;">
                            Após o pagamento, o webhook do Asaas aprovará sua assinatura instantaneamente.
                        </p>

                        <button type="button" onclick="const m = document.getElementById('modal-asaas-checkout'); if (m) { m.classList.remove('show'); m.classList.remove('active'); }" style="background: var(--surface-strong); border: 1px solid var(--border-strong); color: var(--text-main); padding: 10px 20px; border-radius: 8px; cursor: pointer; font-size: 0.9rem; font-weight: 600;">
                            Fechar e Continuar Usando
                        </button>
                    </div>
                </div>
            `;
            document.body.appendChild(modal);
        }

        // Preenche campos se soubermos os dados do salão
        const planSelect = document.getElementById('checkout-plan-select');
        if (planSelect && defaultPlanId) {
            planSelect.value = defaultPlanId;
        }

        const nameInput = document.getElementById('checkout-name');
        if (nameInput && !nameInput.value && window.data && window.data.businessInfo) {
            nameInput.value = window.data.businessInfo.name || '';
        }

        document.getElementById('checkout-form-step').style.display = 'block';
        document.getElementById('checkout-pix-step').style.display = 'none';
        document.getElementById('checkout-error').style.display = 'none';

        modal.classList.add('show');
        modal.classList.add('active');
    },

    async processCheckout(e) {
        e.preventDefault();
        const planId = document.getElementById('checkout-plan-select').value;
        const name = document.getElementById('checkout-name').value;
        const cpf = document.getElementById('checkout-cpf').value;
        const phone = document.getElementById('checkout-phone').value;
        const btn = document.getElementById('btn-submit-checkout');
        const errBox = document.getElementById('checkout-error');

        try {
            btn.disabled = true;
            btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Gerando Cobrança Asaas...';
            errBox.style.display = 'none';

            // O servidor descobre o salão pelo token do login. Mandar o id do
            // salão no corpo deixava qualquer um assinar (e trocar o plano)
            // em nome de outro salão.
            const token = window.DataService ? await DataService.getAccessToken() : null;
            if (!token) {
                throw new Error('Sua sessão expirou. Saia e entre de novo para assinar.');
            }

            const response = await fetch('/api/asaas/create-subscription', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({
                    planId: planId,
                    name: name,
                    cpfCnpj: cpf.replace(/\D/g, ''),
                    phone: phone.replace(/\D/g, ''),
                    billingType: 'PIX'
                })
            });

            const result = await response.json();
            if (!response.ok || !result.ok) {
                throw new Error(result.error || 'Erro ao gerar assinatura no Asaas.');
            }

            // Exibe passo do Pix
            document.getElementById('checkout-form-step').style.display = 'none';
            document.getElementById('checkout-pix-step').style.display = 'block';

            const qrContainer = document.getElementById('checkout-pix-qr-container');
            if (result.pix && result.pix.encodedImage) {
                qrContainer.innerHTML = `<img src="data:image/png;base64,${result.pix.encodedImage}" style="max-width: 200px; border-radius: 10px; border: 1px solid var(--primary); display: inline-block;" />`;
            } else {
                qrContainer.innerHTML = `<p style="font-size: 0.85rem; color: var(--text-muted);">QR Code em processamento no Asaas.</p>`;
            }

            const pixCodeInput = document.getElementById('checkout-pix-code');
            if (pixCodeInput && result.pix && result.pix.payload) {
                pixCodeInput.value = result.pix.payload;
            }

        } catch (err) {
            errBox.style.display = 'block';
            errBox.querySelector('span').textContent = err.message || 'Falha ao processar assinatura.';
            btn.disabled = false;
            btn.innerHTML = '<i class="fa-solid fa-lock"></i> Gerar Assinatura & Pix Asaas';
        }
    },

    copyPixCode() {
        const input = document.getElementById('checkout-pix-code');
        if (input) {
            input.select();
            input.setSelectionRange(0, 99999);
            navigator.clipboard.writeText(input.value);
            if (typeof showToast === 'function') {
                showToast('Código Pix copiado para a área de transferência!', 'success');
            } else {
                alert('Código Pix copiado!');
            }
        }
    },

    /**
     * Exibe banner informativo de período de testes ou pagamento pendente
     */
    // O banner é uma FAIXA acima do cabeçalho, nunca um item dentro dele: o
    // .top-header é flex, e inserir o banner como filho o espremia numa coluna
    // estreita em cima dos botões — era o que aparecia na tela.
    posicionarBanner(banner) {
        const header = document.querySelector('.top-header');
        if (header && header.parentNode) {
            header.parentNode.insertBefore(banner, header);
        } else {
            document.body.insertBefore(banner, document.body.firstChild);
        }
    },

    renderSubscriptionBanner() {
        const existing = document.getElementById('saas-status-banner');
        if (existing) existing.remove();

        // Em teste, quem avisa é o chip do cabeçalho, que ainda mostra quantos
        // dias faltam e leva ao mesmo checkout. Repetir o recado numa faixa
        // rouba uma linha de tela todo dia para dizer o que já está dito ao
        // lado. Fatura pendente é outra conversa: aí a faixa se justifica.
        if (this.subscriptionStatus === 'past_due') {
            const banner = document.createElement('div');
            banner.id = 'saas-status-banner';
            banner.style.cssText = 'background: var(--danger-light); border-bottom: 1px solid var(--danger); padding: 10px 30px; font-size: 0.85rem; color: var(--danger); display: flex; align-items: center; justify-content: space-between; gap: 16px; z-index: 99;';
            banner.innerHTML = `
                <div style="display: flex; align-items: center; gap: 8px;">
                    <i class="fa-solid fa-triangle-exclamation"></i>
                    <span>Sua assinatura está com <strong>fatura pendente</strong>. Regularize para evitar bloqueio da agenda.</span>
                </div>
                <button onclick="SaaSPlanManager.redirectToCheckout()" style="background: var(--danger); color: var(--text-on-status); border: none; font-size: 0.75rem; font-weight: 700; padding: 5px 12px; border-radius: 4px; cursor: pointer; white-space: nowrap;">
                    Pagar Fatura
                </button>
            `;
            this.posicionarBanner(banner);
        }
    }
};

window.SaaSPlanManager = SaaSPlanManager;
