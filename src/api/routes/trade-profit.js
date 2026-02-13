import { Op } from "sequelize";

export async function tradeProfitRoutes(app, { models }) {
    const { TradeProfit } = models;

    app.get("/trade-profit", async (request) => {
        const { trade_instance_id, date_start, date_end, pair } = request.query ?? {};

        const where = {};
        if (trade_instance_id != null && trade_instance_id !== "") {
            where.trade_instance_id = Number(trade_instance_id);
        }
        if (pair != null && pair !== "") where.pair = pair;

        if (date_start || date_end) {
            where.date_transaction = {};
            if (date_start) where.date_transaction[Op.gte] = new Date(`${date_start}T00:00:00Z`);
            if (date_end) where.date_transaction[Op.lte] = new Date(`${date_end}T23:59:59Z`);
        }

        const rows = await TradeProfit.findAll({
            where,
            order: [["id", "DESC"]],
            limit: 5000,
        });

        return rows;
    });

    app.post("/trade-profit", async (request, reply) => {
        const body = request.body ?? {};
        if (!body.date_transaction) body.date_transaction = new Date();

        const row = await TradeProfit.create(body);
        return reply.code(201).send(row);
    });
}
