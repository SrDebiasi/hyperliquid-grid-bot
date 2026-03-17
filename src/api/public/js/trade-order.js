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
    let marginPct = 0;
    let targetPct = 0;
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
    // currentPrice > sellPrice → BTC side (order holds/needs BTC)
    // currentPrice < sellPrice → USD side (order needs USD to buy)
    function computeNeededAll() {
        let btcNeeded = 0;
        let usdNeeded = 0;

        for (const r of rows) {
            const qty = getQty(r);
            if (!(qty > 0)) continue;

            const sellPx = getSellPrice(r);
            const buyPx  = getBuyPrice(r);

            if (currentPrice != null && currentPrice > 0 && sellPx > 0 && currentPrice > sellPx) {
                btcNeeded += qty;
            } else {
                if (buyPx > 0) usdNeeded += buyPx * qty;
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
        // normalize ids to strings for consistency, sort highest price first
        rows = rows
            .map(r => ({ ...r, id: String(r.id) }))
            .sort((a, b) => Number(b.buy_price ?? 0) - Number(a.buy_price ?? 0));

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

        // seed slider from first row's sell USD value
        if (rows.length > 0) {
            const first = rows[0];
            const sellPx = num(first.sell_price);
            const qty = num(first.quantity);
            if (sellPx > 0 && qty > 0) {
                const sellUsd = Math.round(sellPx * qty);
                const clamped = Math.min(Math.max(sellUsd, Number(sliderEl.min)), Number(sliderEl.max));
                sliderEl.value = clamped;
                sliderLabelEl.textContent = `$${clamped}`;
            }
        }

        // baseline (ALL rows)
        const base = computeNeededAll();
        baselineAll = { btc: base.btcNeeded, usd: base.usdNeeded };
        renderTotalsAllWithDelta();

        statusEl.textContent = `Loaded ${rows.length} orders`;
    }

    function extendRowHtml(direction) {
        const preview = computeExtendPreview(direction);
        const label   = direction === 'top' ? '↑ Add level to top' : '↓ Add level to bottom';
        const detail  = preview
            ? `<span class="ms-2 text-muted" style="opacity:.7;">Buy ${fmt(preview.buyPrice, 2)} · Sell ${fmt(preview.sellPrice, 2)} · ${fmt(preview.quantity, 8)} qty</span>`
            : '';
        return `
        <tr class="extend-row" data-extend-direction="${direction}">
          <td colspan="7" class="p-1">
            <button type="button" class="mo-extend-btn btn btn-link btn-sm text-muted w-100 text-start py-1 px-2"
                    style="border:1px dashed var(--bs-border-color);border-radius:4px;">
              <i class="bi bi-plus-circle me-1"></i><span class="small">${label}</span>${detail}
            </button>
          </td>
        </tr>`;
    }

    function renderTable() {
        if (!Array.isArray(rows) || rows.length === 0) {
            tbody.innerHTML = `<tr><td colspan="7" class="text-muted">No orders found.</td></tr>`;
            return;
        }

        const rowsHtml = rows.map((r) => {
            const checked = selectedIds.has(r.id) ? 'checked' : '';
            const qty = getQty(r);

            const buyPx = getBuyPrice(r);
            const sellPx = getSellPrice(r);

            const buyUsd = buyPx > 0 ? buyPx * qty : null;
            const sellUsd = sellPx > 0 ? sellPx * qty : null;

            const hasSell = r.sell_order != null && String(r.sell_order) !== '';
            const rowClass = hasSell ? 'row-sell' : 'row-buy';

            return `
        <tr data-id="${r.id}" class="${rowClass}">
          <td style="width:36px;">
            <input class="form-check-input mo-row-check" type="checkbox" ${checked} />
          </td>

          <td class="text-end fw-medium">${buyPx ? fmt(buyPx, 2) : '<span class="text-muted">—</span>'}</td>
          <td class="text-end text-muted">${buyUsd != null ? fmtUsd(buyUsd) : '<span class="text-muted">—</span>'}</td>

          <td class="text-end fw-medium">${sellPx ? fmt(sellPx, 2) : '<span class="text-muted">—</span>'}</td>
          <td class="text-end text-muted">${sellUsd != null ? fmtUsd(sellUsd) : '<span class="text-muted">—</span>'}</td>

          <td class="text-end text-muted"><span class="mo-qty">${fmt(qty, 8)}</span></td>

          <td class="text-end text-muted">${r.entry_price != null ? fmt(r.entry_price, 2) : '<span class="text-muted">—</span>'}</td>
        </tr>
      `;
        }).join('');

        tbody.innerHTML = extendRowHtml('top') + rowsHtml + extendRowHtml('bottom');

        // Extend button handlers
        tbody.querySelectorAll('.mo-extend-btn').forEach((btn) => {
            btn.addEventListener('click', () => {
                const dir = btn.closest('tr[data-extend-direction]').dataset.extendDirection;
                openExtendModal(dir);
            });
        });

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
        marginPct = Number(btn?.getAttribute('data-margin-percent') || 0);
        targetPct = Number(btn?.getAttribute('data-target-percent') || 0);
        if (btn?.getAttribute('data-decimal-price') != null) decPrice = Number(btn.getAttribute('data-decimal-price'));
        if (btn?.getAttribute('data-decimal-qty') != null) decQty = Number(btn.getAttribute('data-decimal-qty'));
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



    // ─── Extend Grid ─────────────────────────────────────────────────────────────

    function computeExtendPreview(direction) {
        if (!rows.length || !marginPct || !targetPct) return null;

        // rows loaded from API sorted ASC by buy_price, but displayed DESC — use array order
        const sorted = [...rows].sort((a, b) => getBuyPrice(a) - getBuyPrice(b));
        const refOrder = direction === 'top' ? sorted[sorted.length - 1] : sorted[0];

        const refBuy  = getBuyPrice(refOrder);
        const refSell = getSellPrice(refOrder);
        const refQty  = num(refOrder.quantity) ?? 0;
        if (!(refBuy > 0) || !(refSell > 0) || !(refQty > 0)) return null;

        const newBuyPrice  = direction === 'top'
            ? refBuy * (1 + marginPct / 100)
            : refBuy / (1 + marginPct / 100);
        const newSellPrice = newBuyPrice * (1 + targetPct / 100);
        const usdValue     = refSell * refQty;
        const newQuantity  = usdValue / newBuyPrice;

        return {
            buyPrice:      roundTo(newBuyPrice,  decPrice),
            sellPrice:     roundTo(newSellPrice, decPrice),
            quantity:      roundTo(newQuantity,  decQty),
            refEntryPrice: num(refOrder.entry_price),
        };
    }

    let extendModal       = null;
    let extendDirection   = null;
    let extendPreviewData = null;

    function openExtendModal(direction) {
        extendDirection   = direction;
        extendPreviewData = computeExtendPreview(direction);

        if (!extendPreviewData) {
            statusEl.textContent = 'Cannot compute extension — missing config data';
            return;
        }

        const fmtPx = (v) => v != null
            ? '$' + Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
            : '—';

        document.getElementById('moExtendModalTitle').innerHTML =
            `<i class="bi bi-plus-circle text-primary me-2"></i>Add level &mdash; ${direction === 'top' ? '&#8593; Top' : '&#8595; Bottom'}`;

        document.getElementById('moExtendBuyPrice').textContent  = fmtPx(extendPreviewData.buyPrice);
        document.getElementById('moExtendSellPrice').textContent = fmtPx(extendPreviewData.sellPrice);
        document.getElementById('moExtendQty').textContent       = fmt(extendPreviewData.quantity, decQty);

        document.getElementById('moExtendTargetPct').textContent = targetPct ? targetPct + '%' : '—';
        document.getElementById('moExtendMarginPct').textContent = marginPct ? marginPct + '%' : '—';

        document.getElementById('moExtendEntrySameVal').textContent    = fmtPx(extendPreviewData.refEntryPrice);
        document.getElementById('moExtendEntryCurrentVal').textContent = fmtPx(currentPrice);

        document.getElementById('moExtendEntrySame').checked = true;
        const customInput = document.getElementById('moExtendEntryCustomInput');
        customInput.disabled = true;
        customInput.value = '';

        if (!extendModal) {
            const el = document.getElementById('moExtendModal');
            extendModal = new bootstrap.Modal(el, { backdrop: 'static', keyboard: false });

            document.getElementById('moExtendConfirmBtn').addEventListener('click', performExtend);

            ['moExtendEntrySame', 'moExtendEntryCurrent', 'moExtendEntryCustom'].forEach((id) => {
                document.getElementById(id).addEventListener('change', () => {
                    const isCustom = document.getElementById('moExtendEntryCustom').checked;
                    customInput.disabled = !isCustom;
                    if (isCustom) customInput.focus();
                });
            });
        }

        extendModal.show();
    }

    async function performExtend() {
        const type = document.querySelector('input[name="moExtendEntryType"]:checked')?.value;
        let entryPrice;

        if (type === 'same')         entryPrice = extendPreviewData.refEntryPrice;
        else if (type === 'current') entryPrice = currentPrice;
        else                         entryPrice = Number(document.getElementById('moExtendEntryCustomInput').value);

        if (!Number.isFinite(entryPrice) || entryPrice <= 0) {
            statusEl.textContent = 'Invalid entry price';
            return;
        }

        const confirmBtn = document.getElementById('moExtendConfirmBtn');
        confirmBtn.disabled = true;

        try {
            const res = await fetch('/api/trade-order/extend', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    trade_instance_id: tradeInstanceId,
                    direction: extendDirection,
                    entry_price: entryPrice,
                }),
            });

            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                statusEl.textContent = `Failed: ${err.error ?? res.status}`;
                return;
            }

            extendModal.hide();
            statusEl.textContent = 'Level added. Reloading...';
            await loadOrders();
            applySliderValueNow();
        } finally {
            confirmBtn.disabled = false;
        }
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