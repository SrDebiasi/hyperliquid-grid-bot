import { Op, Sequelize } from "sequelize";
import {DateTime} from "luxon";
import { literal } from 'sequelize';
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

            const dateRe = /^\d{4}-\d{2}-\d{2}$/;

            if (date_start) {
                const d0 = String(date_start).slice(0, 10);
                if (!dateRe.test(d0)) return reply.code(400).send({ error: "Invalid date_start format, expected YYYY-MM-DD" });
                where.date_transaction[Op.gte] = Sequelize.cast(`${d0} 00:00:00`, "timestamp");
            }

            if (date_end) {
                const d1 = String(date_end).slice(0, 10);
                if (!dateRe.test(d1)) return reply.code(400).send({ error: "Invalid date_end format, expected YYYY-MM-DD" });
                where.date_transaction[Op.lte] = Sequelize.cast(`${d1} 23:59:59`, "timestamp");
            }
        }
        // app.log.info({ where }, 'tradeProfit where');

        const rows = await TradeProfit.findAll({
            where,
            order: [["id", "DESC"]],
        });

        return rows;
    });


    app.post("/trade-profit", async (request, reply) => {
        const body = request.body ?? {};

        // Normalize UTC instant
        const utc =
            body.date_transaction_utc
                ? DateTime.fromISO(body.date_transaction_utc, { zone: "utc" })
                : DateTime.now().toUTC();

        // Always store UTC as instant-like value (fine)
        body.date_transaction_utc = utc.toISO({ suppressMilliseconds: false });

        // Compute wall-clock string in bot timezone (no offset, stored as-is)
        const localWall = utc.setZone(BOT_TZ).toFormat("yyyy-LL-dd HH:mm:ss.SSS");

        // Guard: Luxon should always produce this format, but validate before
        // interpolating into a SQL literal to prevent any unexpected injection.
        if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}$/.test(localWall)) {
            return reply.code(500).send({ error: "Unexpected timestamp format" });
        }

        const row = await TradeProfit.create({
            ...body,

            // IMPORTANT: this bypasses Sequelize date parsing so the wall-clock
            // string is stored verbatim without UTC conversion.
            date_transaction: literal(`TIMESTAMP '${localWall}'`),
        });

        return reply.code(201).send(row);
    });
}
