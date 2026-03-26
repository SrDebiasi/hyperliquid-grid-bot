(() => {
    console.log("[grid-ui] loaded");

    let lastSimInstanceId = null;
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
        lastSimInstanceId = configId;

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
                const res = await fetch(`/api/trade-instance/${configId}/build-grid`, {
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

            const res = await fetch(`/api/trade-instance/${configId}/simulate?${params.toString()}`, {
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

            simText.innerHTML = `
<div class="border border-border rounded-md p-3 mb-3">
  <div class="text-xs font-semibold uppercase tracking-wider text-muted mb-3">Grid Summary <span class="font-normal opacity-60">(${pair})</span></div>
  <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
    <div>
      <div class="text-xs text-muted mb-1">Range</div>
      <div class="font-semibold">${s.entry_price} → ${s.exit_price}</div>
    </div>
    <div>
      <div class="text-xs text-muted mb-1">Levels (orders)</div>
      <div class="font-semibold">${s.levels}</div>
    </div>
    <div>
      <div class="text-xs text-muted mb-1">Per order</div>
      <div class="font-semibold">$${money(s.usd_per_level)}</div>
    </div>
    <div>
      <div class="text-xs text-muted mb-1">Profit target / Grid spacing</div>
      <div class="font-semibold">${s.target_percent}% / ${s.margin_percent}%</div>
    </div>
  </div>
</div>

<div class="border border-border rounded-md p-3 mb-3">
  <div class="text-xs font-semibold uppercase tracking-wider text-muted mb-3">Capital Needed <span class="font-normal opacity-60">(estimate)</span></div>
  <div class="grid grid-cols-2 md:grid-cols-3 gap-3">
    <div>
      <div class="text-xs text-muted mb-1">Current price</div>
      <div class="font-semibold">${money(s.current_price)}</div>
    </div>
    <div>
      <div class="text-xs text-muted mb-1">If price goes up</div>
      <div class="font-semibold">~$${money(s.base_value_usd)} <span class="text-muted font-normal">(≈ ${num(s.base_needed, 6)})</span></div>
    </div>
    <div>
      <div class="text-xs text-muted mb-1">If price goes down</div>
      <div class="font-semibold">~$${money(s.quote_needed_usd)}</div>
    </div>
  </div>
</div>

<div class="border border-border rounded-md p-3 mb-3">
  <div class="text-xs font-semibold uppercase tracking-wider text-muted mb-3">Range Scenarios</div>
  <div class="grid grid-cols-2 gap-4">
    <div class="border-r border-border pr-4">
      <div class="text-xs text-muted mb-2">If price reaches <strong style="color:var(--foreground)">${s.exit_price}</strong> ↑</div>
      <div class="text-xs text-muted mb-1">Initial BTC cost</div>
      <div class="font-semibold mb-2">$${money(s.base_value_usd)}</div>
      <div class="text-xs text-muted mb-1">Est. profit selling along the way</div>
      <div class="font-semibold text-success">+$${money(s.profit_if_sold_along_the_way)}</div>
    </div>
    <div>
      <div class="text-xs text-muted mb-2">If price drops to <strong style="color:var(--foreground)">${s.entry_price}</strong> ↓</div>
      <div class="text-xs text-muted mb-1">Total BTC held at bottom</div>
      <div class="font-semibold mb-2">${num(s.total_btc_at_bottom, 6)} <span class="text-muted font-normal">(≈ $${money(s.total_value_at_bottom)})</span></div>
      <div class="text-xs text-muted mb-1">Unrealized loss vs capital invested</div>
      <div class="font-semibold text-danger">–$${money(s.downside_unrealized_loss)}</div>
    </div>
  </div>
</div>

<div class="border border-border rounded-md p-3 mb-3">
  <div class="text-xs font-semibold uppercase tracking-wider text-muted mb-3">Profit per cycle finished <span class="font-normal opacity-60">(estimate)</span></div>
  <div class="grid grid-cols-3 gap-3">
    <div>
      <div class="text-xs text-muted mb-1">Gross per cycle</div>
      <div class="font-semibold">$${money(s.gross_profit_per_op_usd)}</div>
    </div>
    <div>
      <div class="text-xs text-muted mb-1">Est. fees per cycle</div>
      <div class="font-semibold text-danger">-$${money(s.est_fees_per_op_usd)}</div>
    </div>
    <div>
      <div class="text-xs text-muted mb-1">Net per cycle</div>
      <div class="font-semibold text-success">$${money(s.est_net_profit_per_op_usd)}</div>
    </div>
  </div>
</div>

<div class="border border-border rounded-md p-3 mb-3 flex justify-between items-center">
  <div class="text-sm text-muted font-semibold">Total capital required</div>
  <div class="font-bold text-lg">$${money(s.est_total_usd_needed)}</div>
</div>

<div class="border border-border rounded-md p-3">
  <div class="text-xs font-semibold uppercase tracking-wider text-muted mb-1">Monthly earnings estimate</div>
  <div class="text-xs text-muted mb-3">Based on total capital × monthly return. Typical grid bots earn 1–5%/month depending on volatility.</div>
  <div class="grid grid-cols-5 gap-2">
    ${[1, 2, 3, 4, 5].map(pct => `
    <div class="border border-border rounded-md p-2 text-center">
      <div class="text-xs text-muted mb-1">${pct}%/mo</div>
      <div class="font-semibold text-success">$${money(s.est_total_usd_needed * pct / 100)}</div>
    </div>`).join("")}
  </div>
</div>`;

            lastSimInputs = inputs;
            approveBtn.disabled = false;
        } catch (e) {
            simStatus.innerHTML = "";
            simText.textContent = "";
            simError.innerHTML = `<div class="alert alert-danger mb-0">Simulation error: ${String(e?.message ?? e)}</div>`;
        }
    }

    function openSimulationFlow(configId) {
        lastSimInstanceId = configId;
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
            if (!lastSimInstanceId) return;
            void runSimulation(lastSimInstanceId);
        }
    });

    document.addEventListener("DOMContentLoaded", () => {
        const cfgId = window.__GRID_UI__?.configId;
        if (cfgId) {
            lastSimInstanceId = cfgId;
            setSimButtons(cfgId);
        }
    });
})();