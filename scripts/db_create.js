import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
const { Client } = pg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
function required(name, value) {
    if (!value) throw new Error(`Missing env var: ${name}`);
    return value;
}
async function ensureDatabaseExists({ host, port, user, password, dbName }) {
    const admin = new Client({
        host,
        port,
        user,
        password,
        database: 'postgres',
    });
    await admin.connect();
    try {
        const res = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName]);
        if (res.rowCount === 0) {
            await admin.query(`CREATE DATABASE "${dbName}"`);
            console.log(`Created database: ${dbName}`);
        } else {
            console.log(`Database already exists: ${dbName}`);
        }
    } finally {
        await admin.end();
    }
}
async function runSqlFile({ host, port, user, password, dbName, sqlPath }) {
    const sql = fs.readFileSync(sqlPath, 'utf8');
    const client = new Client({ host, port, user, password, database: dbName });
    await client.connect();
    try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('COMMIT');
        console.log(`Applied schema from ${path.basename(sqlPath)} to ${dbName}`);
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
    } finally {
        await client.end();
    }
}
async function main() {
    const host = required('DB_HOST', process.env.DB_HOST);
    const port = Number(process.env.DB_PORT || '5432');
    const dbName = required('DB_NAME', process.env.DB_NAME);
    const user = required('DB_USER', process.env.DB_USER);
    const password = process.env.DB_PASS || '';
    const sqlPath = path.resolve(__dirname, '../src/db/db.sql');
    if (!fs.existsSync(sqlPath)) {
        throw new Error(`db.sql not found at: ${sqlPath}`);
    }
    await ensureDatabaseExists({ host, port, user, password, dbName });
    await runSqlFile({ host, port, user, password, dbName, sqlPath });
}
main().catch((err) => {
    console.error('db:create failed:', err?.message || err);
    process.exit(1);
});
