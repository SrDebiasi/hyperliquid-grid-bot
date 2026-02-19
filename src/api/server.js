import "dotenv/config";
import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import cors from "@fastify/cors";
import formbody from "@fastify/formbody";
import view from "@fastify/view";
import ejs from "ejs";
import path from "node:path";

import { fileURLToPath } from "node:url";

import { connectDb, sequelize } from "./db.js";
import { tradeConfigRoutes } from "./routes/trade-config.js";
import { tradeOrderRoutes } from "./routes/trade-order.js";
import { tradeInstanceRoutes } from "./routes/trade-instance.js";
import { tradeProfitRoutes } from "./routes/trade-profit.js";
import { messageRoutes } from "./routes/message.js";
import { openOrdersRoutes } from "./routes/open-orders.js";
import { orderHistoryRoutes } from "./routes/order-history.js";
import { buildModels } from "./models/index.js";
import { dashboardRoutes } from "./routes/dashboard.js";

const PORT = Number(process.env.API_PORT ?? 3000);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);


export async function buildServer() {
    const app = Fastify({ logger: true });

    await app.register(cors, { origin: true, credentials: true });
    await app.register(formbody);

    // Static
    await app.register(fastifyStatic, {
        root: path.join(__dirname, "public"),
        prefix: "/",
    });

    // Views (EJS)
    await app.register(view, {
        engine: { ejs },
        root: path.join(__dirname, "views"),
    });

    const models = buildModels(sequelize);

    app.get("/health", async () => ({ ok: true }));

    app.get("/health/db", async () => {
        try {
            await sequelize.authenticate();
            return { ok: true };
        } catch (e) {
            return { ok: false, error: String(e?.message ?? e) };
        }
    });


    // Dashboard page routes (no /api prefix)
    await app.register(dashboardRoutes, { models });
    // Existing API routes
    await app.register(tradeConfigRoutes, { prefix: "/api", models });
    await app.register(tradeOrderRoutes, { prefix: "/api", models });
    await app.register(tradeInstanceRoutes, { prefix: "/api", models });
    await app.register(tradeProfitRoutes, { prefix: "/api", models });
    await app.register(messageRoutes, { prefix: "/api", models });
    await app.register(openOrdersRoutes, { prefix: "/api", models });
    await app.register(orderHistoryRoutes, { prefix: "/api", models });

    return app;
}

async function start() {
    await connectDb({ retries: 10, delayMs: 1000 });

    const app = await buildServer();
    const HOST = process.env.API_HOST ?? "127.0.0.1";
    await app.listen({ port: PORT, host: HOST });

    app.log.info(`API listening on :${PORT}`);
}

start().catch((err) => {
    console.error(err);
    process.exit(1);
});
