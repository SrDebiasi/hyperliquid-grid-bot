(() => {
    console.log("[grid-ui] loaded");

    let lastSimConfigId = null;
    let lastSimInputs = null;

    function money(n) {
        const x = Number(n);
        if (!Number.isFinite(x)) return String(n ?? "");
        return x.toFixed(2);
    }

    function num(n, d) {
        const x = Number(n);
        if (!Number.isFinite(x)) return String(n ?? "");
        return x.toFixed(d ?? 6);
    }

    function getEl(id) {
        return document.getElementById(id);
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

    function clearSimState() {
        const simError = getEl("simError");
        const simStatus = getEl("simStatus");
        const simText = getEl("simText");
        const btn = getEl("simApproveBtn");

        if (simError) simError.innerHTML = "";
        if (simStatus) simStatus.innerHTML = "";
        if (simText) simText.textContent = "";
        if (btn) btn.disabled = true;

        lastSimInputs = null;
    }

    function getSimulationInputs() {
        const entryPrice = getEl("simEntryPrice")?.value?.trim() ?? "";
        const exitPrice = getEl("simExitPrice")?.value?.trim() ?? "";
        const usdTransaction = getEl("simUsdTransaction")?.value?.trim() ?? "";

        return {
            entry_price: entryPrice,
            exit_price: exitPrice,
            usd_transaction: usdTransaction,
        };
    }

    function validateSimulationInputs(inputs) {
        const errors = [];

        const entry = Number(inputs.entry_price);
        const exit = Number(inputs.exit_price);
        const usd = Number(inputs.usd_transaction);

        if (inputs.entry_price === "" || !Number.isFinite(entry) || entry <= 0) {
            errors.push("Entry Price must be greater than 0");
        }

        if (inputs.exit_price === "" || !Number.isFinite(exit) || exit <= 0) {
            errors.push("Exit Price must be greater than 0");
        }

        if (Number.isFinite(entry) && Number.isFinite(exit) && exit <= entry) {
            errors.push("Exit Price must be greater than Entry Price");
        }

        if (inputs.usd_transaction === "" || !Number.isFinite(usd) || usd <= 0) {
            errors.push("USD / level must be greater than 0");
        }

        return errors;
    }

    function setSimButtons(configId) {
        lastSimConfigId = configId;

        const btn = getEl("simApproveBtn");
        if (!btn) return;

        btn.disabled = true;

        btn.onclick = async () => {
            const simError = getEl("simError");
            const simStatus = getEl("simStatus");

            if (!lastSimInputs) {
                simError.innerHTML = '<div class="alert alert-danger mb-0">Run the simulation first.</div>';
                return;
            }

            simError.innerHTML = "";
            simStatus.innerHTML = '<div class="alert alert-info mb-0">Generating grid...</div>';
            btn.disabled = true;

            try {
                const res = await fetch(`/api/trade-config/${configId}/build-grid`, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "Accept": "application/json",
                    },
                    body: JSON.stringify(lastSimInputs),
                });

                const payload = await res.json();

                if (!res.ok) {
                    simStatus.innerHTML = "";
                    simError.innerHTML = `<div class="alert alert-danger mb-0">${payload?.error ?? "Failed to generate grid"}</div>`;
                    btn.disabled = false;
                    return;
                }

                const saved = Number(payload?.savedCount ?? 0);
                simStatus.innerHTML = `<div class="alert alert-success mb-0">Saved ${saved} orders ✅</div>`;

                setTimeout(() => {
                    const el = getEl("simModal");
                    const modal = bootstrap.Modal.getInstance(el);
                    modal?.hide();
                }, 900);
            } catch (e) {
                simStatus.innerHTML = "";
                simError.innerHTML = `<div class="alert alert-danger mb-0">Error: ${String(e?.message ?? e)}</div>`;
                btn.disabled = false;
            }
        };
    }

    async function runSimulation(configId) {
        const simError = getEl("simError");
        const simStatus = getEl("simStatus");
        const simText = getEl("simText");
        const approveBtn = getEl("simApproveBtn");

        const inputs = getSimulationInputs();
        const validationErrors = validateSimulationInputs(inputs);

        simError.innerHTML = "";
        simStatus.innerHTML = "";
        simText.textContent = "";
        approveBtn.disabled = true;
        lastSimInputs = null;

        if (validationErrors.length) {
            simError.innerHTML = `<div class="alert alert-danger mb-0">${validationErrors.join("<br>")}</div>`;
            return;
        }

        simStatus.innerHTML = '<div class="alert alert-info mb-0">Running simulation...</div>';
        simText.textContent = "Loading...";

        try {
            const params = new URLSearchParams({
                entry_price: inputs.entry_price,
                exit_price: inputs.exit_price,
                usd_transaction: inputs.usd_transaction,
            });

            const res = await fetch(`/api/trade-config/${configId}/simulate?${params.toString()}`, {
                headers: { Accept: "application/json" },
            });

            const payload = await res.json();

            simStatus.innerHTML = "";

            if (!res.ok) {
                simText.textContent = "";
                simError.innerHTML = `<div class="alert alert-danger mb-0">${payload?.error ?? "Simulation failed"}</div>`;
                return;
            }

            const s = payload.summary;
            const pair = payload?.meta?.pair ?? "";

            const lines = [
                `GRID SUMMARY (${pair})`,
                `Range: <strong>${s.entry_price}</strong> → <strong>${s.exit_price}</strong>`,
                `Levels (orders): <strong>${s.levels}</strong>`,
                `Per order: <strong>$${money(s.usd_per_level)}</strong> | Profit target per level: <strong>${s.target_percent}%</strong> | Grid spacing: <strong>${s.margin_percent}%</strong>`,
                ``,
                `CAPITAL NEEDED (ESTIMATE)`,
                `Current price: <strong>${money(s.current_price)}</strong>`,
                `If price goes UP: need <strong>~${num(s.base_needed, 6)}</strong> (≈ <strong>$${money(s.base_value_usd)}</strong>)`,
                `If price goes DOWN: need <strong>~$${money(s.quote_needed_usd)}</strong>`,
                ``,
                `POTENTIAL UPSIDE (ONE-WAY MOVE UP THROUGH THE GRID)`,
                `If you buy the required amount now and price reaches <strong>${s.exit_price}</strong>:`,
                `- Buy cost today: <strong>$${money(s.base_value_usd)}</strong>`,
                `- Estimated profit if sold along the way: <strong>$${money(s.profit_if_sold_along_the_way)}</strong>`,
                ``,
                `PER-TRADE PROFIT (ESTIMATE)`,
                `Gross profit per completed cycle: <strong>$${money(s.gross_profit_per_op_usd)}</strong>`,
                `Estimated fees per cycle: <strong>$${money(s.est_fees_per_op_usd)}</strong>`,
                `Estimated net profit per operation: <strong>$${money(s.est_net_profit_per_op_usd)}</strong>`,
                `Total estimated capital required: <strong>$${money(s.est_total_usd_needed)}</strong>`,
            ];

            simText.innerHTML = lines.join("<br>");

            lastSimInputs = inputs;
            approveBtn.disabled = false;
        } catch (e) {
            simStatus.innerHTML = "";
            simText.textContent = "";
            simError.innerHTML = `<div class="alert alert-danger mb-0">Simulation error: ${String(e?.message ?? e)}</div>`;
        }
    }

    function openSimulationFlow(configId) {
        lastSimConfigId = configId;
        clearSimState();
        setSimButtons(configId);

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

    document.addEventListener("click", (ev) => {
        const simulateTriggerBtn = ev.target.closest('[data-grid-simulate="true"]');
        if (simulateTriggerBtn) {
            const configId = Number(simulateTriggerBtn.getAttribute("data-config-id"));
            if (!configId) return;

            openSimulationFlow(configId);
            return;
        }

        const simRunBtn = ev.target.closest("#simRunBtn");
        if (simRunBtn) {
            if (!lastSimConfigId) return;
            void runSimulation(lastSimConfigId);
        }
    });

    document.addEventListener("DOMContentLoaded", () => {
        const cfgId = window.__GRID_UI__?.configId;
        if (cfgId) {
            lastSimConfigId = cfgId;
            setSimButtons(cfgId);
        }
    });
})();