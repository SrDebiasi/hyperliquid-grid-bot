import { Op } from "sequelize";
import {DateTime} from "luxon";

const BOT_TZ = process.env.BOT_TZ || "America/Edmonton";

export async function tradeProfitRoutes(app, { models }) {
    const { TradeProfit } = models;

    app.get("/trade-profit", async (request) => {
        const { trade_instance_id, date_start, date_end, pair, timezone } = request.query ?? {};
        const tz = timezone || BOT_TZ;

        const where = {};
        if (trade_instance_id != null && trade_instance_id !== "") {
            where.trade_instance_id = Number(trade_instance_id);
        }
        if (pair != null && pair !== "") where.pair = pair;

        if (date_start || date_end) {
            where.date_transaction = {};

            if (date_start) {
                const startUtc = DateTime.fromISO(date_start, { zone: tz })
                    .startOf("day")
                    .toUTC()
                    .toJSDate();
                where.date_transaction[Op.gte] = startUtc;
            }

            if (date_end) {
                // end-exclusive: next day at 00:00 in tz, converted to UTC
                const endUtcExclusive = DateTime.fromISO(date_end, { zone: tz })
                    .startOf("day")
                    .plus({ days: 1 })
                    .toUTC()
                    .toJSDate();
                where.date_transaction[Op.lt] = endUtcExclusive;
            }
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
