(() => {
    const modalEl = document.getElementById('manageOrdersModal');
    if (!modalEl) return;

    let decQty = 5;   // default
    let decPrice = 0; // default (optional)

    // Header fields
    const curPriceEl = document.getElementById('moCurrentPrice');
    const btcNeededEl = document.getElementById('moBtcNeeded');
    const usdNeededEl = document.getElementById('moUsdNeeded');
    const btcDeltaEl = document.getElementById('moBtcDelta');
    const usdDeltaEl = document.getElementById('moUsdDelta');
    const statusEl = document.getElementById('moStatus');
    const netChangeEl = document.getElementById('moNetChange');
    const rollbackBtn = document.getElementById('moRollbackBtn');

    // Table + controls
    const tbody = document.getElementById('moTbody');
    const selectAllEl = document.getElementById('moSelectAll');
    const saveBtn = document.getElementById('moSaveBtn');
    const deleteBtn = document.getElementById('moDeleteBtn');

    // Slider
    const sliderEl = document.getElementById('moValueSlider');
    const sliderLabelEl = document.getElementById('moValueSliderLabel');

    // In-memory state
    let tradeInstanceId = null;
    let pair = null;
    let rows = [];
    let selectedIds = new Set();      // selection is ONLY for which rows get resized
    let editedQtyById = new Map();    // id -> newQty
    let currentPrice = null;
    let confirmModal;
    let confirmProceedBtn;
    let saving = false;

    let deleteModal;
    let deleteProceedBtn;
    let deleteCountEl;

    // Baseline is for ALL rows (not selection)
    let baselineAll = { btc: null, usd: null };

    const num = (v) => {
        const n = Number(v);
        return Number.isFinite(n) ? n : null;
    };

    const fmt = (v, digits = 2) => {
        const n = num(v);
        if (n === null) return '-';
        return n.toLocaleString(undefined, { maximumFractionDigits: digits });
    };

    const fmtUsd = (v) => {
        const n = num(v);
        if (n === null) return '-';
        return '$' + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    };

    const getQty = (row) => {
        const edited = editedQtyById.get(row.id);
        if (edited != null) return edited;
        return num(row.quantity) ?? 0;
    };

    const getBuyPrice = (row) => num(row.buy_price) ?? 0;
    const getSellPrice = (row) => num(row.sell_price) ?? 0;

    async function fetchMarket(pair, tradeInstanceId) {
        const qs = new URLSearchParams();
        if (pair) qs.set('pair', String(pair));
        if (tradeInstanceId) qs.set('trade_instance_id', String(tradeInstanceId));

        const res = await fetch(`/api/market/price?${qs.toString()}`, { headers: { Accept: 'application/json' } });
        if (!res.ok) return { price: null, dp: null, dq: null };

        const json = await res.json();
        const price = Number(json?.price ?? json?.currentPrice);
        const dp = json?.dp != null ? Number(json.dp) : null;
        const dq = json?.dq != null ? Number(json.dq) : null;

        return {
            price: Number.isFinite(price) && price > 0 ? price : null,
            dp: Number.isFinite(dp) && dp >= 0 ? dp : null,
            dq: Number.isFinite(dq) && dq >= 0 ? dq : null,
        };
    }

    // Needed computation for ALL rows (selection does NOT affect totals)
    function computeNeededAll() {
        let btcNeeded = 0;
        let usdNeeded = 0;

        for (const r of rows) {
            const qty = getQty(r);
            if (!(qty > 0)) continue;

            const hasSellOrder = r.sell_order_id != null && String(r.sell_order_id) !== '';
            const hasBuyOrder  = r.buy_order_id  != null && String(r.buy_order_id)  !== '';

            if (hasSellOrder) {
                btcNeeded += qty;
                continue;
            }

            if (hasBuyOrder) {
                const buyPx = getBuyPrice(r);
                if (buyPx > 0) usdNeeded += buyPx * qty;
                continue;
            }

            const entryPx = num(r.entry_price) ?? 0;
            if (currentPrice == null || currentPrice <= 0 || entryPx <= 0) continue;

            // Infer when no order ids
            if (entryPx > currentPrice) {
                btcNeeded += qty;
            } else {
                const buyPx = getBuyPrice(r);
                const px = buyPx > 0 ? buyPx : entryPx;
                usdNeeded += px * qty;
            }
        }

        return { btcNeeded, usdNeeded };
    }

    function renderTotalsAllWithDelta() {
        const cur = computeNeededAll();

        btcNeededEl.textContent = fmt(cur.btcNeeded, 8);
        usdNeededEl.textContent = fmtUsd(cur.usdNeeded);

        if (!btcDeltaEl || !usdDeltaEl) return;

        if (baselineAll.btc == null || baselineAll.usd == null) {
            btcDeltaEl.textContent = '';
            usdDeltaEl.textContent = '';
            btcDeltaEl.className = 'ms-2 small';
            usdDeltaEl.className = 'ms-2 small';
            return;
        }

        const btcDiff = cur.btcNeeded - baselineAll.btc;
        const usdDiff = cur.usdNeeded - baselineAll.usd;

        const eps = 1e-12;

        const renderDelta = (el, diff, text) => {
            if (Math.abs(diff) < eps) {
                el.textContent = '';
                el.className = 'ms-2 small';
                return;
            }
            el.textContent = text;
            el.className = `ms-2 small ${diff > 0 ? 'text-success' : 'text-danger'}`;
        };

        renderDelta(btcDeltaEl, btcDiff, `${btcDiff > 0 ? '+' : ''}${fmt(btcDiff, 8)}`);

        if (netChangeEl) {
            const eps = 1e-12;

            if (
                baselineAll.btc == null ||
                baselineAll.usd == null ||
                currentPrice == null ||
                currentPrice <= 0 ||
                (Math.abs(btcDiff) < eps && Math.abs(usdDiff) < eps)
            ) {
                netChangeEl.textContent = '';
                netChangeEl.className = 'ms-3 small';
            } else {
                const net = usdDiff + (btcDiff * currentPrice);
                const abs = Math.abs(net).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                const text = net >= 0 ? `Change: +$${abs}` : `Change: -$${abs}`;
                netChangeEl.textContent = text;
                netChangeEl.className = `ms-3 small ${net >= 0 ? 'text-success' : 'text-danger'}`;
            }
        }

        // USD delta as +$ / -$
        const absUsd = Math.abs(usdDiff).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        const usdText = usdDiff >= 0 ? `+$${absUsd}` : `-$${absUsd}`;
        renderDelta(usdDeltaEl, usdDiff, usdText);
    }

    function markDirty() {
        const dirty = editedQtyById.size > 0;
        saveBtn.disabled = !dirty;
        if (rollbackBtn) rollbackBtn.disabled = !dirty;
    }

    if (rollbackBtn) {
        rollbackBtn.addEventListener('click', () => {
            editedQtyById.clear();

            // reset slider label only (optional)
            // sliderEl.value = 100; sliderLabelEl.textContent = `$${sliderEl.value}`;

            renderTable();

            // reset baseline so deltas go back to empty
            const base = computeNeededAll();
            baselineAll = { btc: base.btcNeeded, usd: base.usdNeeded };
            renderTotalsAllWithDelta();

            markDirty();
            statusEl.textContent = 'Rolled back local changes';
        });
    }

    function roundTo(n, decimals) {
        if (!Number.isFinite(n)) return n;
        const d = Number(decimals ?? 0);
        if (!Number.isFinite(d) || d < 0) return n;
        return Number(n.toFixed(d));
    }

    async function loadOrders() {
        if (!tradeInstanceId) return;

        statusEl.textContent = 'Loading orders...';
        tbody.innerHTML = `<tr><td colspan="11" class="text-muted">Loading...</td></tr>`;

        const qs = new URLSearchParams({
            trade_instance_id: String(tradeInstanceId),
            pair: pair ?? ''
        });

        const res = await fetch(`/api/trade-order?${qs.toString()}`, {
            headers: { 'Accept': 'application/json' }
        });

        if (!res.ok) {
            statusEl.textContent = `Failed to load orders (${res.status})`;
            tbody.innerHTML = `<tr><td colspan="11" class="text-danger">Failed to load orders.</td></tr>`;
            return;
        }

        const m = await fetchMarket(pair, tradeInstanceId);
        currentPrice = m.price;
        if (m.dq != null) decQty = m.dq;
        if (m.dp != null) decPrice = m.dp;

        rows = await res.json();
        // normalize ids to strings for consistency
        rows = rows.map(r => ({ ...r, id: String(r.id) }));

        // selection defaults to all (ONLY affects which rows slider edits)
        selectedIds = new Set(rows.map(r => r.id));

        // reset edits
        editedQtyById.clear();
        saveBtn.disabled = true;
        selectAllEl.checked = true;

        // price
        curPriceEl.textContent =
            currentPrice != null
                ? '$' + currentPrice.toLocaleString(undefined, { minimumFractionDigits: decPrice, maximumFractionDigits: decPrice })
                : '-';

        renderTable();

        // baseline (ALL rows)
        const base = computeNeededAll();
        baselineAll = { btc: base.btcNeeded, usd: base.usdNeeded };
        renderTotalsAllWithDelta();

        statusEl.textContent = `Loaded ${rows.length} orders`;
    }

    function renderTable() {
        if (!Array.isArray(rows) || rows.length === 0) {
            tbody.innerHTML = `<tr><td colspan="11" class="text-muted">No orders found.</td></tr>`;
            return;
        }

        tbody.innerHTML = rows.map((r) => {
            const checked = selectedIds.has(r.id) ? 'checked' : '';
            const qty = getQty(r);

            const buyPx = getBuyPrice(r);
            const sellPx = getSellPrice(r);

            const buyUsd = buyPx > 0 ? buyPx * qty : null;
            const sellUsd = sellPx > 0 ? sellPx * qty : null;

            const lastPlaced = r.last_order_placed_at || r.last_order_placed || r.updated_at || '';

            return `
        <tr data-id="${r.id}">
          <td>
            <input class="form-check-input mo-row-check" type="checkbox" ${checked} />
          </td>
          <td class="text-nowrap">${r.status ?? '-'}</td>

          <td class="text-nowrap">${buyPx ? fmt(buyPx, 2) : '-'}</td>
          <td class="text-nowrap">${r.buy_order_id ?? '-'}</td>
          <td class="text-nowrap">${buyUsd != null ? fmtUsd(buyUsd) : '-'}</td>

          <td class="text-nowrap">${sellPx ? fmt(sellPx, 2) : '-'}</td>
          <td class="text-nowrap">${r.sell_order_id ?? '-'}</td>
          <td class="text-nowrap">${sellUsd != null ? fmtUsd(sellUsd) : '-'}</td>

          <td class="text-nowrap"><span class="mo-qty">${fmt(qty, 8)}</span></td>

          <td class="text-nowrap">${lastPlaced ? String(lastPlaced) : '-'}</td>
          <td class="text-nowrap">${r.entry_price != null ? fmt(r.entry_price, 2) : '-'}</td>
        </tr>
      `;
        }).join('');

        // Row checkbox handlers (only affects which rows slider edits)
        tbody.querySelectorAll('.mo-row-check').forEach((el) => {
            el.addEventListener('change', (e) => {
                const tr = e.target.closest('tr');
                const id = tr.dataset.id; // string

                if (e.target.checked) selectedIds.add(id);
                else selectedIds.delete(id);

                selectAllEl.checked = selectedIds.size === rows.length;
                deleteBtn.disabled = selectedIds.size == 0;
            });
        });
    }

    // Slider auto-apply (selection only controls which rows change)
    sliderLabelEl.textContent = `$${sliderEl.value}`;
    let sliderTimer = null;

    function applySliderValueNow() {
        const targetUsd = Number(sliderEl.value);
        if (!Number.isFinite(targetUsd) || targetUsd <= 0) return;

        let changedCount = 0;

        for (const r of rows) {
            if (!selectedIds.has(r.id)) continue;

            const sellPx = getSellPrice(r);
            const buyPx = getBuyPrice(r);

            const px = sellPx > 0 ? sellPx : (buyPx > 0 ? buyPx : 0);
            if (px <= 0) continue;

            const newQty = roundTo(targetUsd / px, decQty);
            editedQtyById.set(r.id, newQty);
            changedCount++;
        }

        renderTable();
        renderTotalsAllWithDelta();
        markDirty();

        statusEl.textContent = `Applied $${targetUsd} to ${changedCount} selected orders`;
    }

    sliderEl.addEventListener('input', () => {
        sliderLabelEl.textContent = `$${sliderEl.value}`;

        if (sliderTimer) clearTimeout(sliderTimer);
        sliderTimer = setTimeout(() => {
            applySliderValueNow();
        }, 120);
    });

    sliderEl.addEventListener('change', () => {
        if (sliderTimer) clearTimeout(sliderTimer);
        applySliderValueNow();
    });

    // Select all (only affects which rows slider edits)
    selectAllEl.addEventListener('change', (e) => {
        if (e.target.checked) selectedIds = new Set(rows.map(r => r.id));
        else selectedIds = new Set();

        renderTable();
        // totals do NOT depend on selection anymore
    });

    // Save changes
    saveBtn.addEventListener('click', async () => {
        if (editedQtyById.size === 0) return;

        ensureConfirmModal();

        // Make the proceed button run the save exactly once per open
        confirmProceedBtn.onclick = async () => {
            confirmProceedBtn.disabled = true;
            try {
                confirmModal.hide();
                await performSave();
            } finally {
                confirmProceedBtn.disabled = false;
                confirmProceedBtn.onclick = null;
            }
        };

        confirmModal.show();
    });

    // Bootstrap modal event
    modalEl.addEventListener('show.bs.modal', (evt) => {
        const btn = evt.relatedTarget;
        tradeInstanceId = Number(btn?.getAttribute('data-trade-instance-id') || '');
        pair = btn?.getAttribute('data-pair') || null;
        void loadOrders();
    });

    // When user clicks Delete -> show confirm modal with count
    deleteBtn.addEventListener('click', async () => {
        const ids = getSelectedOrderIds();
        if (ids.length === 0) return;

        ensureDeleteModal();
        deleteCountEl.textContent = String(ids.length);

        deleteProceedBtn.onclick = async () => {
            deleteProceedBtn.disabled = true;
            try {
                deleteModal.hide();
                await performDelete(ids);
            } finally {
                deleteProceedBtn.disabled = false;
                deleteProceedBtn.onclick = null;
            }
        };

        deleteModal.show();
    });

    function ensureConfirmModal() {
        if (confirmModal) return;
        const el = document.getElementById('moConfirmSaveModal');
        confirmProceedBtn = document.getElementById('moConfirmSaveProceedBtn');
        confirmModal = new bootstrap.Modal(el, { backdrop: 'static', keyboard: false });
    }

    function ensureDeleteModal() {
        if (deleteModal) return;
        const el = document.getElementById('moConfirmDeleteModal');
        deleteProceedBtn = document.getElementById('moConfirmDeleteProceedBtn');
        deleteCountEl = document.getElementById('moDeleteCount');
        deleteModal = new bootstrap.Modal(el, { backdrop: 'static', keyboard: false });
    }

    // You likely already have row checkboxes. Assume each row checkbox has:
    //  <input type="checkbox" class="form-check-input moRowCheck" data-id="123" checked>
    function getSelectedOrderIds() {
        const nodes = tbody.querySelectorAll('.mo-row-check:checked');
        const ids = [];
        nodes.forEach((n) => {
            const tr = n.closest('tr');
            const id = Number(tr?.dataset?.id);
            if (Number.isFinite(id) && id > 0) ids.push(id);
        });
        return ids;
    }

    async function performDelete(ids) {
        statusEl.textContent = 'Deleting...';

        const res = await fetch('/api/trade-order/bulk', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids }),
        });

        if (!res.ok) {
            statusEl.textContent = `Delete failed (${res.status})`;
            return;
        }

        statusEl.textContent = 'Deleted. Reloading...';
        await loadOrders();
    }



    // Do the actual save work here
    async function performSave() {
        if (saving) return;
        if (editedQtyById.size === 0) return;

        saving = true;
        saveBtn.disabled = true;

        try {
            const updates = Array.from(editedQtyById.entries()).map(([id, quantity]) => ({ id, quantity }));

            statusEl.textContent = 'Saving changes...';

            const res = await fetch('/api/trade-order/bulk-qty', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ updates }),
            });

            if (!res.ok) {
                statusEl.textContent = `Save failed (${res.status})`;
                return;
            }

            statusEl.textContent = 'Saved. Reloading...';
            await loadOrders(); // resets baselineAll too
        } finally {
            saving = false;
            // re-enable only if there are still edits after reload (usually none)
            saveBtn.disabled = editedQtyById.size === 0;
        }
    }
})();