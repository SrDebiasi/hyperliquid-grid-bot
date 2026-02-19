(() => {
    console.log("[grid-ui] loaded");
    let lastSimConfigId = null;

    function money(n) {
        const x = Number(n);
        if (!Number.isFinite(x)) return String(n ?? '');
        return x.toFixed(2);
    }

    function num(n, d) {
        const x = Number(n);
        if (!Number.isFinite(x)) return String(n ?? '');
        return x.toFixed(d ?? 6);
    }

    function getEl(id) {
        return document.getElementById(id);
    }

    function showSimModal() {
        const el = getEl('simModal');
        const modal = bootstrap.Modal.getOrCreateInstance(el);
        modal.show();
    }

    function hideModal(id) {
        const el = document.getElementById(id);
        if (!el) return;
        const modal = bootstrap.Modal.getInstance(el) || bootstrap.Modal.getOrCreateInstance(el);
        modal.hide();
    }

    function showModal(id) {
        const el = document.getElementById(id);
        if (!el) return;
        const modal = bootstrap.Modal.getOrCreateInstance(el);
        modal.show();
    }

    function setSimButtons(configId) {
        lastSimConfigId = configId;

        const btn = getEl('simApproveBtn');
        if (!btn) return;

        btn.disabled = false;

        btn.onclick = async () => {
            const simError = getEl('simError');
            const simStatus = getEl('simStatus');

            simError.innerHTML = '';
            simStatus.innerHTML = '<div class="alert alert-info mb-0">Generating grid...</div>';
            btn.disabled = true;

            try {
                const res = await fetch(`/api/trade-config/${configId}/build-grid`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
                    body: JSON.stringify({}),
                });

                const payload = await res.json();

                if (!res.ok) {
                    simStatus.innerHTML = '';
                    simError.innerHTML = `<div class="alert alert-danger mb-0">${payload?.error ?? 'Failed to generate grid'}</div>`;
                    btn.disabled = false;
                    return;
                }

                const saved = Number(payload?.savedCount ?? 0);
                simStatus.innerHTML = `<div class="alert alert-success mb-0">Saved ${saved} orders ✅</div>`;

                setTimeout(() => {
                    const el = getEl('simModal');
                    const modal = bootstrap.Modal.getInstance(el);
                    modal?.hide();
                }, 900);
            } catch (e) {
                simStatus.innerHTML = '';
                simError.innerHTML = `<div class="alert alert-danger mb-0">Error: ${String(e?.message ?? e)}</div>`;
                btn.disabled = false;
            }
        };
    }

    async function simulateGrid(configId) {
        const simError = getEl('simError');
        const simStatus = getEl('simStatus');
        const simText = getEl('simText');

        simError.innerHTML = '';
        simStatus.innerHTML = '';
        simText.textContent = 'Loading...';

        setSimButtons(configId);

        try {
            const res = await fetch(`/api/trade-config/${configId}/simulate`, {
                headers: { 'Accept': 'application/json' },
            });

            const payload = await res.json();

            if (!res.ok) {
                simText.textContent = '';
                simError.innerHTML = `<div class="alert alert-danger mb-0">${payload?.error ?? 'Simulation failed'}</div>`;
            } else {
                const s = payload.summary;
                const pair = payload?.meta?.pair ?? '';

                const lines = [
                    `GRID SUMMARY (${pair})`,
                    `Range: ${s.entry_price} → ${s.exit_price}`,
                    `Levels (orders): ${s.levels}`,
                    `Per order: $${money(s.usd_per_level)} | Profit target per level: ${s.target_percent}% | Grid spacing: ${s.margin_percent}%`,
                    ``,
                    `CAPITAL NEEDED (ESTIMATE)`,
                    `Current price: ${money(s.current_price)}`,
                    `If price goes UP: need ~${num(s.base_needed, 6)} (≈ $${money(s.base_value_usd)})`,
                    `If price goes DOWN: need ~$${money(s.quote_needed_usd)}`,
                    ``,
                    `POTENTIAL UPSIDE (ONE-WAY MOVE UP THROUGH THE GRID)`,
                    `If you buy the required amount now and price reaches ${s.exit_price}:`,
                    `- Buy cost today: $${money(s.base_value_usd)}`,
                    `- Total proceeds if sold along the way: $${money(s.profit_if_sold_along_the_way)}`,
                    ``,
                    `PER-TRADE PROFIT (ESTIMATE)`,
                    `Gross profit per completed cycle: $${money(s.gross_profit_per_op_usd)}`,
                    `Estimated fees per cycle: $${money(s.est_fees_per_op_usd)}`,
                    `Estimated net profit per operation: $${money(s.est_net_profit_per_op_usd)}`,
                    `Total estimated capital required: $${money(s.est_total_usd_needed)}`,
                ];

                simText.textContent = lines.join('\n');
            }

            const cfgEl = document.getElementById("configModal");

            if (cfgEl && bootstrap.Modal.getInstance(cfgEl)) {
                cfgEl.addEventListener(
                    "hidden.bs.modal",
                    () => showModal("simModal"),
                    { once: true }
                );
                hideModal("configModal");
            } else {
                showModal("simModal");
            }
        } catch (e) {
            simText.textContent = '';
            simError.innerHTML = `<div class="alert alert-danger mb-0">Simulation error: ${String(e?.message ?? e)}</div>`;
            const cfgEl = document.getElementById("configModal");

            if (cfgEl && bootstrap.Modal.getInstance(cfgEl)) {
                cfgEl.addEventListener(
                    "hidden.bs.modal",
                    () => showModal("simModal"),
                    { once: true }
                );
                hideModal("configModal");
            } else {
                showModal("simModal");
            }
        }
    }

    // Event wiring (no inline onclick)
    document.addEventListener('click', (ev) => {
        const btn = ev.target.closest('[data-grid-simulate="true"]');
        if (!btn) return;

        const configId = Number(btn.getAttribute('data-config-id'));
        if (!configId) return;

        void simulateGrid(configId);
    });

    // If you want: auto-wire last config from server
    document.addEventListener('DOMContentLoaded', () => {
        const cfgId = window.__GRID_UI__?.configId;
        if (cfgId) setSimButtons(cfgId);
    });
})();
