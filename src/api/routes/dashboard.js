// src/api/routes/dashboard.js


import {getProfitSummary} from "../../reports/profitReportService.js";
import {ensureBotRunning, getBotLogs, getBotStatus, stopBot} from "../../services/pm2Service.js";
import {fetchHyperliquidMidFromPair} from "../../functions/functions.js";


// Shared loader used by /dashboard and /dashboard/profits
async function loadDashboardData({ models }) {
    const instanceRow = await models.TradeInstance.findOne({ order: [["id", "ASC"]] });
    const instance = instanceRow ? instanceRow.toJSON() : null;

    let config = null;
    let orders = [];
    let profitSummary = null;
    let rebuy = {};
    let portfolioOverview = null;

    if (instance) {
        const configRow = await models.TradeConfig.findOne({
            where: { trade_instance_id: instance.id },
            order: [["id", "ASC"]],
        });
        config = configRow ? configRow.toJSON() : null;

        const ordersRaw = await models.TradeOrder.findAll({
            where: { trade_instance_id: instance.id },
        });

        orders = ordersRaw
            .map((o) => o.get({ plain: true }))
            .sort((a, b) => Number(a.buy_price ?? 0) - Number(b.buy_price ?? 0));

        profitSummary = await getProfitSummary({ models, tradeInstanceId: instance.id });

        if (config) {
            const currentPrice = Number(await fetchHyperliquidMidFromPair(config.pair) ?? 0);

            const reboughtCoin = Number(config.rebought_coin ?? 0);
            const reboughtValueUsd = Number(config.rebought_value ?? 0);
            const currentValueUsd = reboughtCoin * currentPrice;
            const avgPriceUsd = reboughtCoin > 0 ? reboughtValueUsd / reboughtCoin : 0;

            rebuy = {
                active: config.rebuy_profit,
                reboughtCoin,
                reboughtValueUsd,
                currentPrice,
                currentValueUsd,
                avgPriceUsd,
                name: config.name,
            };

            const getOrderEntryValue = (order) => {
                const buyPrice = Number(order.buy_price ?? 0);
                const sellPrice = Number(order.sell_price ?? 0);
                const entryPrice = Number(order.entry_price ?? 0);
                const quantity = Number(order.quantity ?? 0);

                if (
                    !Number.isFinite(buyPrice) ||
                    !Number.isFinite(sellPrice) ||
                    !Number.isFinite(entryPrice) ||
                    !Number.isFinite(quantity) ||
                    quantity <= 0
                ) {
                    return 0;
                }

                if (sellPrice > entryPrice) {
                    return entryPrice * quantity;
                }

                return buyPrice * quantity;
            };

            const getOrderCurrentValue = (order, currentPrice) => {
                const buyPrice = Number(order.buy_price ?? 0);
                const sellPrice = Number(order.sell_price ?? 0);
                const entryPrice = Number(order.entry_price ?? 0);
                const quantity = Number(order.quantity ?? 0);

                if (
                    !Number.isFinite(buyPrice) ||
                    !Number.isFinite(sellPrice) ||
                    !Number.isFinite(entryPrice) ||
                    !Number.isFinite(quantity) ||
                    !Number.isFinite(currentPrice) ||
                    quantity <= 0 ||
                    currentPrice <= 0
                ) {
                    return 0;
                }

                if (sellPrice > currentPrice) {
                    return currentPrice * quantity;
                }

                if (sellPrice > entryPrice) {
                    return sellPrice * quantity;
                }

                return buyPrice * quantity;
            };

            const valueAtEntry = orders.reduce((sum, order) => {
                return sum + getOrderEntryValue(order);
            }, 0);

            const valueAtCurrent = orders.reduce((sum, order) => {
                return sum + getOrderCurrentValue(order, currentPrice);
            }, 0);

            const entryTotals = orders.reduce((acc, order) => {
                const entryPrice = Number(order.entry_price ?? 0);
                const quantity = Number(order.quantity ?? 0);

                if (
                    !Number.isFinite(entryPrice) ||
                    entryPrice <= 0 ||
                    !Number.isFinite(quantity) ||
                    quantity <= 0
                ) {
                    return acc;
                }

                acc.weightedEntryValue += entryPrice * quantity;
                acc.totalQuantity += quantity;
                return acc;
            }, {
                weightedEntryValue: 0,
                totalQuantity: 0,
            });

            const avgEntryPrice = entryTotals.totalQuantity > 0
                ? entryTotals.weightedEntryValue / entryTotals.totalQuantity
                : 0;

            const realizedProfit = Number(profitSummary?.totals?.allTime?.totalUsd ?? 0);

            const currentPortfolio = valueAtCurrent + realizedProfit;
            const portfolioDeltaUsd = currentPortfolio - valueAtEntry;
            const portfolioDeltaPercent = valueAtEntry > 0
                ? (portfolioDeltaUsd / valueAtEntry) * 100
                : 0;


            portfolioOverview = {
                symbol: config.name,
                avgEntryPrice,
                currentPrice,
                valueAtEntry,
                valueAtCurrent,
                realizedProfit,
                currentPortfolio,
                portfolioDeltaUsd,
                portfolioDeltaPercent,
            };
        }
    }

    const botStatus = instance
        ? await getBotStatus({ instanceId: instance.id })
        : { isRunning: false, statusText: "stopped" };

    const envWalletAddress = process.env.WALLET_ADDRESS || '';
    const envPrivateKey    = process.env.PRIVATE_KEY    || '';
    const envSecretsConfigured = !!(envWalletAddress && envPrivateKey);

    const envTelegramBotToken          = process.env.TELEGRAM_BOT_TOKEN            || '';
    const envTelegramChatId            = process.env.TELEGRAM_CHAT_ID              || '';
    const envHealthchecksPingUrl       = process.env.HEALTHCHECKS_PING_URL         || '';
    const envHealthchecksPingIntervalMs = process.env.HEALTHCHECKS_PING_INTERVAL_MS || '0';
    const envBotTz                     = process.env.BOT_TZ                        || 'America/Edmonton';
    const envHyperliquidTestnet        = process.env.HYPERLIQUID_TESTNET            || '0';

    return {
        instance,
        config,
        orders,
        profitSummary,
        rebuy,
        portfolioOverview,
        botStatus,
        envSecretsConfigured,
        envWalletAddress,
        envPrivateKey,
        envTelegramBotToken,
        envTelegramChatId,
        envHealthchecksPingUrl,
        envHealthchecksPingIntervalMs,
        envBotTz,
        envHyperliquidTestnet,
    };
}

export async function dashboardRoutes(app, opts) {
    const { models } = opts;

    app.get("/dashboard", async (request, reply) => {
        const data = await loadDashboardData({ models });

        return reply.view("layout.ejs", {
            page: "pages/dashboard.ejs",
            title: "Grid Bot Dashboard",
            now: new Date().toISOString(),
            ...data,
        });
    });

    app.get("/dashboard/profits", async (request, reply) => {
        const { profitSummary, portfolioOverview, rebuy } = await loadDashboardData({ models });

        return reply.view("partials/profits.ejs", { profitSummary, portfolioOverview, rebuy });
    });

    app.post("/dashboard/instances/:id/start", async (request, reply) => {
        const instanceId = Number(request.params.id);
        if (!Number.isFinite(instanceId)) return reply.code(400).send({ error: "Invalid instance id" });

        await ensureBotRunning({ instanceId });
        return reply.redirect("/dashboard");
    });

    app.post("/dashboard/instances/:id/stop", async (request, reply) => {
        const instanceId = Number(request.params.id);
        if (!Number.isFinite(instanceId)) return reply.code(400).send({ error: "Invalid instance id" });

        await stopBot({ instanceId });
        return reply.redirect("/dashboard");
    });

    app.get("/dashboard/instances/:id/logs", async (request, reply) => {
        const instanceId = Number(request.params.id);
        const lines = Math.min(Number(request.query.lines ?? 100) || 100, 500);

        if (!Number.isFinite(instanceId)) return reply.code(400).send("Invalid instance id");

        const logs = await getBotLogs({ instanceId, lines });

        return reply.view("partials/pm2_logs.ejs", { logs, lines });
    });
}
