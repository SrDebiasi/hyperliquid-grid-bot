import { Op, Sequelize } from "sequelize";
import { DateTime } from "luxon";
import { literal } from "sequelize";
export async function tradeCycleRoutes(app, { models }) {
    const { TradeCycle, TradeInstance } = models;

    app.get("/trade-cycle", async (request) => {
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
                where.date_transaction[Op.lte] = Sequelize.cast(`${d1} 23:59:59.999999`, "timestamp");
            }
        }

        const rows = await TradeCycle.findAll({
            where,
            order: [["id", "DESC"]],
        });

        return rows;
    });

    app.post("/trade-cycle", async (request, reply) => {
        const body = request.body ?? {};

        const instance = body.trade_instance_id
            ? await TradeInstance.findByPk(body.trade_instance_id)
            : null;
        const botTz = instance?.bot_tz || 'America/Edmonton';

        const utc =
            body.date_transaction_utc
                ? DateTime.fromISO(body.date_transaction_utc, { zone: "utc" })
                : DateTime.now().toUTC();

        body.date_transaction_utc = utc.toISO({ suppressMilliseconds: false });

        const localWall = utc.setZone(botTz).toFormat("yyyy-LL-dd HH:mm:ss.SSS");

        if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}$/.test(localWall)) {
            return reply.code(500).send({ error: "Unexpected timestamp format" });
        }

        const row = await TradeCycle.create({
            ...body,
            date_transaction: literal(`TIMESTAMP '${localWall}'`),
        });

        return reply.code(201).send(row);
    });
}
