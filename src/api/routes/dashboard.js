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

        if (config) {
            const currentPrice = await fetchHyperliquidMidFromPair(config.pair);

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
        }

        profitSummary = await getProfitSummary({ models, tradeInstanceId: instance.id });
    }

    const botStatus = instance
        ? await getBotStatus({ instanceId: instance.id })
        : { isRunning: false, statusText: "stopped" };

    return { instance, config, orders, profitSummary, rebuy, botStatus };
}

export async function dashboardRoutes(app, opts) {
    const { models } = opts;

    app.get("/dashboard", async (request, reply) => {
        const { instance, config, orders, profitSummary, rebuy, botStatus } =
            await loadDashboardData({ models });

        return reply.view("layout.ejs", {
            page: "pages/dashboard.ejs",
            title: "Grid Bot Dashboard",
            now: new Date().toISOString(),
            instance,
            botStatus,
            config,
            orders,
            profitSummary,
            rebuy,
        });
    });

    app.get("/dashboard/profits", async (request, reply) => {
        const { profitSummary, rebuy } = await loadDashboardData({ models });

        return reply.view("partials/profits.ejs", { profitSummary, rebuy });
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
