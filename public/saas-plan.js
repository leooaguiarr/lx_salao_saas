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
            badge.style.cssText = 'font-size: 0.65rem; background: rgba(212, 175, 55, 0.2); color: #d4af37; padding: 2px 6px; border-radius: 4px; margin-left: auto; display: inline-flex; align-items: center; gap: 4px; border: 1px solid rgba(212, 175, 55, 0.4);';
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
                    <div style="width: 60px; height: 60px; border-radius: 50%; background: rgba(212, 175, 55, 0.15); border: 1px solid rgba(212, 175, 55, 0.3); display: flex; align-items: center; justify-content: center; margin: 0 auto 16px; font-size: 1.6rem; color: #d4af37;">
                        <i class="fa-solid fa-crown"></i>
                    </div>
                    <h3 id="upgrade-modal-title" style="margin-bottom: 8px; font-size: 1.3rem;">Recurso Exclusivo</h3>
                    <p id="upgrade-modal-desc" style="color: #a1a1aa; font-size: 0.92rem; line-height: 1.5; margin-bottom: 24px;"></p>
                    <div style="background: rgba(255, 255, 255, 0.03); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 12px; padding: 16px; margin-bottom: 24px; text-align: left;">
                        <div style="font-weight: 600; font-size: 0.95rem; margin-bottom: 6px; color: #f4f4f5;" id="upgrade-modal-plan-name">Plano Recomendado</div>
                        <div style="font-size: 0.85rem; color: #71717a;" id="upgrade-modal-plan-features">Libere este recurso e potencialize seu faturamento.</div>
                    </div>
                    <div style="display: flex; gap: 12px;">
                        <button type="button" class="btn btn-secondary" style="flex: 1;" onclick="document.getElementById('modal-upgrade-saas').classList.remove('active')">Voltar</button>
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

        modal.classList.add('active');
    },

    redirectToCheckout() {
        // Redireciona para tela de assinatura / checkout Asaas
        alert('Redirecionando para o checkout seguro de assinatura Asaas...');
        const modal = document.getElementById('modal-upgrade-saas');
        if (modal) modal.classList.remove('active');
    },

    /**
     * Exibe banner informativo de período de testes ou pagamento pendente
     */
    renderSubscriptionBanner() {
        const existing = document.getElementById('saas-status-banner');
        if (existing) existing.remove();

        if (this.subscriptionStatus === 'trial') {
            const banner = document.createElement('div');
            banner.id = 'saas-status-banner';
            banner.style.cssText = 'background: linear-gradient(90deg, #18181b, #27272a); border-bottom: 1px solid rgba(212, 175, 55, 0.3); padding: 8px 16px; font-size: 0.82rem; color: #d4af37; display: flex; align-items: center; justify-content: space-between; z-index: 99;';
            banner.innerHTML = `
                <div style="display: flex; align-items: center; gap: 8px;">
                    <i class="fa-solid fa-clock"></i>
                    <span>Você está no <strong>Período de Testes Grátis</strong> (${this.getPlan().name}).</span>
                </div>
                <button onclick="SaaSPlanManager.redirectToCheckout()" style="background: #d4af37; color: #000; border: none; font-size: 0.75rem; font-weight: 700; padding: 4px 10px; border-radius: 4px; cursor: pointer;">
                    Ativar Assinatura
                </button>
            `;
            const header = document.querySelector('header') || document.body;
            header.insertBefore(banner, header.firstChild);
        } else if (this.subscriptionStatus === 'past_due') {
            const banner = document.createElement('div');
            banner.id = 'saas-status-banner';
            banner.style.cssText = 'background: #7f1d1d; border-bottom: 1px solid #ef4444; padding: 10px 16px; font-size: 0.85rem; color: #fecaca; display: flex; align-items: center; justify-content: space-between; z-index: 99;';
            banner.innerHTML = `
                <div style="display: flex; align-items: center; gap: 8px;">
                    <i class="fa-solid fa-triangle-exclamation"></i>
                    <span>Sua assinatura está com <strong>fatura pendente</strong>. Regularize para evitar bloqueio da agenda.</span>
                </div>
                <button onclick="SaaSPlanManager.redirectToCheckout()" style="background: #ef4444; color: #fff; border: none; font-size: 0.75rem; font-weight: 700; padding: 5px 12px; border-radius: 4px; cursor: pointer;">
                    Pagar Fatura
                </button>
            `;
            const header = document.querySelector('header') || document.body;
            header.insertBefore(banner, header.firstChild);
        }
    }
};

window.SaaSPlanManager = SaaSPlanManager;
