import { Op, Sequelize } from "sequelize";
import {DateTime} from "luxon";

const BOT_TZ = process.env.BOT_TZ || "America/Edmonton";

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

            if (date_start) {
                const d0 = String(date_start).slice(0, 10);
                where.date_transaction[Op.gte] = Sequelize.cast(`${d0} 00:00:00`, "timestamp");
            }

            if (date_end) {
                const d1 = String(date_end).slice(0, 10);
                where.date_transaction[Op.lte] = Sequelize.cast(`${d1} 23:59:59`, "timestamp");
            }
        }
        // app.log.info({ where }, 'tradeProfit where');

        const rows = await TradeProfit.findAll({
            where,
            order: [["id", "DESC"]],
            limit: 5000,
            logging: console.log,
        });

        return rows;
    });

    app.post("/trade-profit", async (request, reply) => {
        const body = request.body ?? {};
        if (!body.date_transaction_utc) body.date_transaction_utc = new Date();
        if (!body.date_transaction)
            body.date_transaction = DateTime.fromJSDate(body.date_transaction_utc, { zone: "utc" }).setZone(BOT_TZ).toFormat("yyyy-LL-dd HH:mm:ss.SSS");

        const row = await TradeProfit.create(body);
        return reply.code(201).send(row);
    });
}
