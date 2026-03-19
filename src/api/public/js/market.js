// public/js/market.js
if (!window.__marketSingletonLoaded) {
    window.__marketSingletonLoaded = true;

    (function () {
        let chart = null;
        let series = null;
        let ro = null;

        // Keep handles so we can remove lines properly
        let orderLineObjs = [];
        let bandLineObjs = [];

        function fmt(n) {
            if (!Number.isFinite(n)) return "—";
            return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
        }

        function ensureChart(container) {
            const LC = window.LightweightCharts;
            if (!LC?.createChart) {
                console.error("[market] LightweightCharts not found");
                return false;
            }

            if (chart && series) return true;

            // LightweightCharts does not support oklch() colors, so we convert
            // CSS custom properties to rgb() via Canvas2D (which handles oklch natively).
            const isDark = document.documentElement.getAttribute("data-bs-theme") === "dark";
            function resolveColor(varName, fallback) {
                try {
                    const raw = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
                    if (!raw) return fallback;
                    const canvas = document.createElement('canvas');
                    canvas.width = canvas.height = 1;
                    const ctx = canvas.getContext('2d');
                    ctx.fillStyle = raw;
                    ctx.fillRect(0, 0, 1, 1);
                    const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
                    return `rgb(${r}, ${g}, ${b})`;
                } catch (_) { return fallback; }
            }
            const bgColor   = resolveColor('--card',             isDark ? '#181d26' : '#fcfcfe');
            const textColor = resolveColor('--muted-foreground', isDark ? '#6a7585' : '#5a6475');
            const borderClr = resolveColor('--border',           isDark ? '#262e3e' : '#d8dce8');

            chart = LC.createChart(container, {
                height: 340,
                layout: {
                    background: { color: bgColor },
                    textColor,
                },
                rightPriceScale: { borderVisible: false },
                timeScale: { borderVisible: false, borderColor: borderClr },
                grid: { vertLines: { visible: false }, horzLines: { visible: false } },
            });

            series = chart.addSeries(LC.CandlestickSeries, {});
            chart.timeScale().fitContent(); // only once on init

            ro = new ResizeObserver(() => {
                chart?.applyOptions({ width: container.clientWidth });
            });
            ro.observe(container);

            return true;
        }

        function destroyChart() {
            // clear timer
            if (window.__marketTimer) {
                clearInterval(window.__marketTimer);
                window.__marketTimer = null;
            }

            // remove lines
            if (series) {
                removeLines(orderLineObjs);
                removeLines(bandLineObjs);
            } else {
                orderLineObjs.length = 0;
                bandLineObjs.length = 0;
            }

            try { ro?.disconnect(); } catch (_) {}
            ro = null;

            try { chart?.remove(); } catch (_) {}
            chart = null;
            series = null;
        }

        function removeLines(list) {
            // Correct v5 removal: series.removePriceLine(handle)
            if (!series) {
                list.length = 0;
                return;
            }

            for (const pl of list) {
                try {
                    series.removePriceLine(pl);
                } catch (_) {
                    // fallback (older examples use pl.remove(); keep as no-op safety)
                    try { pl?.remove?.(); } catch (_) {}
                }
            }
            list.length = 0;
        }

        function readCfgFromDom() {
            const symbol = document.getElementById("mktSymbol")?.textContent?.trim() || "BTCUSDT";
            const interval = document.getElementById("mktInterval")?.textContent?.trim() || "5m";
            const daysRaw = Number(document.getElementById("mktDays")?.textContent?.trim() || 5);
            const days = Number.isFinite(daysRaw) ? daysRaw : 5;
            return { symbol, interval, days };
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

        function drawBandTopBot(candles, bandCfg) {
            if (!series) return;

            // remove previous band lines
            removeLines(bandLineObjs);

            const rangePct = Number(bandCfg?.rangePct ?? 0);
            if (!Number.isFinite(rangePct) || rangePct <= 0) {
                const rangeEl = document.getElementById("mktRange");
                const rangePctLabelEl = document.getElementById("mktRangePctLabel");
                if (rangePctLabelEl) rangePctLabelEl.textContent = "—";
                if (rangeEl) rangeEl.textContent = "—";
                return;
            }

            const useWicks = Boolean(bandCfg?.useWicks ?? true);
            const band = computeDynamicRange(candles, rangePct, useWicks);
            if (!band) return;

            const LC = window.LightweightCharts;
            const isDark = document.documentElement.getAttribute("data-bs-theme") === "dark";
            const bandLineColor = isDark ? "rgba(255,255,255,0.85)" : "rgba(0,0,0,0.85)";

            bandLineObjs.push(
                series.createPriceLine({
                    price: band.top,
                    color: bandLineColor,
                    lineWidth: 2,
                    lineStyle: LC.LineStyle.Solid,
                    axisLabelVisible: true,
                    title: "Top",
                }),
                series.createPriceLine({
                    price: band.bot,
                    color: bandLineColor,
                    lineWidth: 2,
                    lineStyle: LC.LineStyle.Solid,
                    axisLabelVisible: true,
                    title: "Bot",
                })
            );

            const rangeEl = document.getElementById("mktRange");
            const rangePctLabelEl = document.getElementById("mktRangePctLabel");
            if (rangePctLabelEl) rangePctLabelEl.textContent = String(rangePct);
            if (rangeEl) rangeEl.textContent = `${fmt(band.bot)} → ${fmt(band.top)}`;
        }

        function drawOrderLines(orderLines) {
            if (!series) return;

            // remove previous order lines
            removeLines(orderLineObjs);

            const LC = window.LightweightCharts;

            for (const ol of orderLines || []) {
                const price = Number(ol.price);
                if (!Number.isFinite(price)) continue;

                const isBuy = ol.side === "BUY";
                const color = isBuy
                    ? "rgba(34, 197, 94, 0.10)"
                    : "rgba(59, 130, 246, 0.10)";

                const pl = series.createPriceLine({
                    price,
                    color,
                    lineWidth: 0.5,
                    lineStyle: LC.LineStyle.Solid,
                    axisLabelVisible: true,
                    title: "",
                });

                orderLineObjs.push(pl);
            }
        }

        async function refreshMarket() {
            if (window.__marketRefreshInFlight) return;
            window.__marketRefreshInFlight = true;

            try {
                const container = document.getElementById("mktChart");
                if (!container) return;

                if (!ensureChart(container)) return;

                const { symbol, interval, days } = readCfgFromDom();

                const res = await fetch(
                    `/api/market/klines?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(interval)}&days=${days}`
                );
                const json = await res.json();

                const candles = (json.candles || []).slice().sort((a, b) => a.time - b.time);
                const last = candles[candles.length - 1];

                series.setData(candles);

                const priceEl = document.getElementById("mktLastPrice");
                if (priceEl) priceEl.textContent = last ? fmt(last.close) : "—";

                drawBandTopBot(candles, json.band);
                drawOrderLines(json.orderLines);
            } catch (e) {
                console.error("[market] refresh failed", e);
            } finally {
                window.__marketRefreshInFlight = false;
            }
        }

        window.initMarket = function initMarket() {
            // Always restart timer globally (never duplicates)
            if (window.__marketTimer) clearInterval(window.__marketTimer);

            refreshMarket();

            window.__marketTimer = setInterval(() => {
                refreshMarket();
            }, 60_000);
        };

        document.addEventListener("DOMContentLoaded", () => {
            window.initMarket?.();
        });

        // Optional cleanup if you ever navigate away / replace DOM:
        window.__destroyMarketChart = destroyChart;
    })();
}