// public/js/market.js
(async function () {

    const cfg = {
        symbol: "BTCUSDT",
        interval: "5m",
        days: 5,

        // grid
        stepPct: 0.1,
        levels: 120,

        // dynamic band
        rangePct: 1.8,
        useWicks: true,
    };

    const el = document.getElementById("mktChart");
    if (!el) return;

    const priceEl = document.getElementById("mktLastPrice");
    const anchorEl = document.getElementById("mktAnchor");
    const rangeEl = document.getElementById("mktRange");

    const LC = window.LightweightCharts;
    if (!LC?.createChart) {
        console.error("[market] LightweightCharts not found");
        return;
    }

    function fmt(n) {
        if (!Number.isFinite(n)) return "—";
        return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
    }

    function startOfDayUTCFromSec(sec) {
        const ms = sec * 1000;
        const d = new Date(ms);
        return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0) / 1000;
    }

    function computeDailyOpenAnchor(candles) {
        if (!candles.length) return null;

        const last = candles[candles.length - 1];
        const todayStart = startOfDayUTCFromSec(last.time);

        const exact = candles.find((x) => x.time === todayStart);
        if (exact) return exact.open;

        const fallback = candles.find((x) => x.time >= todayStart);
        return fallback ? fallback.open : candles[0].open;
    }

    function computeDynamicRange(candles, rangePct, useWicks) {
        if (!candles.length) return null;

        const mult = 1 + rangePct / 100;

        let top = candles[0].close;
        let bot = top / mult;

        for (const c of candles) {
            const hi = useWicks ? c.high : c.close;
            const lo = useWicks ? c.low : c.close;

            if (hi > top) {
                top = hi;
                bot = top / mult;
            }
            if (lo < bot) {
                bot = lo;
                top = bot * mult;
            }
        }

        return { top, bot };
    }

    const res = await fetch(
        `/api/market/klines?symbol=${encodeURIComponent(cfg.symbol)}&interval=${encodeURIComponent(cfg.interval)}&days=${cfg.days}`
    );
    const json = await res.json();

    cfg.stepPct = Number(json?.grid?.stepPct ?? cfg.stepPct);
    cfg.levels  = Number(json?.grid?.levels ?? cfg.levels);
    cfg.rangePct = Number(json?.band?.rangePct ?? cfg.rangePct);
    cfg.useWicks = Boolean(json?.band?.useWicks ?? cfg.useWicks);

    const stepPct = Number(json?.grid?.stepPct ?? cfg.stepPct);
    const rangePct = Number(json?.band?.rangePct ?? cfg.rangePct);

    const stepEl = document.getElementById("mktStepPct");
    const rangePctEl = document.getElementById("mktRangePct");
    const rangePctLabelEl = document.getElementById("mktRangePctLabel");

    if (stepEl) stepEl.textContent = String(stepPct);
    if (rangePctEl) rangePctEl.textContent = String(rangePct);
    if (rangePctLabelEl) rangePctLabelEl.textContent = String(rangePct);

    const candles = (json.candles || []).slice().sort((a, b) => a.time - b.time);
    const last = candles[candles.length - 1];

    const chart = LC.createChart(el, {
        height: 340,
        rightPriceScale: { borderVisible: false },
        timeScale: { borderVisible: false },

        grid: {
            vertLines: { visible: false },
            horzLines: { visible: false },
        },
    });

    const series = chart.addSeries(LC.CandlestickSeries, {});

    series.setData(candles);
    chart.timeScale().fitContent();

    // --- UI texts ---
    if (priceEl) priceEl.textContent = last ? fmt(last.close) : "—";

    const anchor = computeDailyOpenAnchor(candles);
    if (anchorEl) anchorEl.textContent = fmt(anchor);

    const band = computeDynamicRange(candles, cfg.rangePct, cfg.useWicks);
    if (rangeEl && band) rangeEl.textContent = `${fmt(band.bot)} → ${fmt(band.top)}`;
    if (rangeEl && !band) rangeEl.textContent = "—";

    // --- Draw lines ---
    const gridLines = [];
    const bandLines = [];

    function removePriceLines(list) {
        for (const pl of list) {
            try {
                pl.remove();
            } catch (_) {}
        }
        list.length = 0;
    }

    function drawLines() {
        removePriceLines(gridLines);
        removePriceLines(bandLines);

        if (!Number.isFinite(anchor)) return;

        // grid lines — SKIP the middle range (bot..top)
        for (let i = -cfg.levels; i <= cfg.levels; i++) {
            const p = anchor * (1 + (i * cfg.stepPct) / 100);

            if (band && p >= band.bot && p <= band.top) continue;

            const pl = series.createPriceLine({
                price: p,
                color: "rgba(0, 140, 255, 0.18)",
                lineWidth: 1,
                lineStyle: LC.LineStyle.Solid,
                axisLabelVisible: false,
                title: "",
            });
            gridLines.push(pl);
        }

        // band top/bot lines
        if (band) {
            const topLine = series.createPriceLine({
                price: band.top,
                color: "rgba(0,0,0,0.85)",
                lineWidth: 2,
                lineStyle: LC.LineStyle.Solid,
                axisLabelVisible: true,
                title: "Top",
            });

            const botLine = series.createPriceLine({
                price: band.bot,
                color: "rgba(0,0,0,0.85)",
                lineWidth: 2,
                lineStyle: LC.LineStyle.Solid,
                axisLabelVisible: true,
                title: "Bot",
            });

            bandLines.push(topLine, botLine);

            // --- filled band (simple way) ---
            // LightweightCharts doesn't support "fill between two price lines" directly,
            // so we draw a translucent rectangle overlay in the chart container.
            // This is a lightweight hack and looks close to TradingView.

            renderBandOverlay(chart, band.bot, band.top);
        } else {
            renderBandOverlay(chart, null, null);
        }
    }

    let bandOverlayEl = null;

    function renderBandOverlay(chart, bot, top) {
        const container = el; // chart container div (mktChart)
        if (!bandOverlayEl) {
            bandOverlayEl = document.createElement("div");
            bandOverlayEl.style.position = "absolute";
            bandOverlayEl.style.left = "0";
            bandOverlayEl.style.right = "0";
            bandOverlayEl.style.pointerEvents = "none";
            bandOverlayEl.style.background = "rgba(255,255,255,0.12)";
            bandOverlayEl.style.borderTop = "1px solid rgba(255,255,255,0.25)";
            bandOverlayEl.style.borderBottom = "1px solid rgba(255,255,255,0.25)";

            // make sure container can host an absolute overlay
            const cs = getComputedStyle(container);
            if (cs.position === "static") container.style.position = "relative";

            container.appendChild(bandOverlayEl);
        }

        if (!Number.isFinite(bot) || !Number.isFinite(top)) {
            bandOverlayEl.style.display = "none";
            return;
        }

        bandOverlayEl.style.display = "block";

        // Convert prices to Y pixels using price scale
        const priceScale = series.priceScale();
        const yTop = priceScale.priceToCoordinate(top);
        const yBot = priceScale.priceToCoordinate(bot);

        if (yTop == null || yBot == null) {
            bandOverlayEl.style.display = "none";
            return;
        }

        const y1 = Math.min(yTop, yBot);
        const y2 = Math.max(yTop, yBot);

        bandOverlayEl.style.top = `${y1}px`;
        bandOverlayEl.style.height = `${Math.max(1, y2 - y1)}px`;
    }

    const orderLineObjs = [];

    function clearOrderLines() {
        for (const pl of orderLineObjs) {
            try { pl.remove(); } catch (_) {}
        }
        orderLineObjs.length = 0;
    }

    function drawOrderLines(orderLines) {
        clearOrderLines();

        for (const ol of orderLines || []) {
            const price = Number(ol.price);
            if (!Number.isFinite(price)) continue;

            const isBuy = ol.side === "BUY";
            const color = isBuy
                ? "rgba(0, 160, 0, 0.18)"
                : "rgba(200, 0, 0, 0.18)";


            const pl = series.createPriceLine({
                price,
                color,
                lineWidth: 0.5,
                lineStyle: LC.LineStyle.Solid,

                axisLabelVisible: true,
                title : "",
            });

            orderLineObjs.push(pl);
        }
    }



    drawOrderLines(json.orderLines);

    // Resize handling
    const ro = new ResizeObserver(() => {
        chart.applyOptions({ width: el.clientWidth });
    });
    ro.observe(el);
})();