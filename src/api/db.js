// src/api/db.js
import 'dotenv/config';
import { Sequelize } from 'sequelize';

const {
    DB_HOST = '127.0.0.1',
    DB_PORT = '5432',
    DB_NAME,
    DB_USER,
    DB_PASS,
    DB_SSL = 'false',
} = process.env;

if (!DB_NAME || !DB_USER) {
    throw new Error('Missing DB_NAME / DB_USER in env');
}

const sslEnabled = String(DB_SSL).toLowerCase() === 'true';

// Sequelize instance
export const sequelize = new Sequelize(DB_NAME, DB_USER, DB_PASS ?? '', {
    host: DB_HOST,
    port: Number(DB_PORT),
    dialect: 'postgres',
    logging: false, // muda pra console.log se quiser debug SQL
    dialectOptions: sslEnabled
        ? { ssl: { require: true, rejectUnauthorized: false } }
        : {},
});

// Simple connect helper (with optional retries)
export async function connectDb({ retries = 5, delayMs = 1000 } = {}) {
    let lastErr = null;

    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            await sequelize.authenticate();
            return;
        } catch (err) {
            lastErr = err;
            if (attempt < retries) {
                await new Promise((r) => setTimeout(r, delayMs));
            }
        }
    }

    throw lastErr;
}
