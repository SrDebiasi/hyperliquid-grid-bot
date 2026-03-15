import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import pg from 'pg';

const { Client } = pg;
const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

function required(name, value) {
    if (!value) throw new Error(`Missing env var: ${name}`);
    return value;
}

async function ensureMigrationsTable(client) {
    await client.query(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
            id         SERIAL PRIMARY KEY,
            name       VARCHAR(255) NOT NULL UNIQUE,
            applied_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
        )
    `);
}

async function appliedMigrations(client) {
    const res = await client.query('SELECT name FROM schema_migrations ORDER BY name');
    return new Set(res.rows.map(r => r.name));
}

async function runMigration(client, name, up) {
    await client.query('BEGIN');
    try {
        await up(client);
        await client.query(
            'INSERT INTO schema_migrations (name) VALUES ($1)',
            [name]
        );
        await client.query('COMMIT');
        console.log(`  ✓ ${name}`);
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
    }
}

async function main() {
    const host   = required('DB_HOST', process.env.DB_HOST);
    const port   = Number(process.env.DB_PORT || '5432');
    const dbName = required('DB_NAME', process.env.DB_NAME);
    const user   = required('DB_USER', process.env.DB_USER);
    const password = process.env.DB_PASS || '';

    const client = new Client({ host, port, user, password, database: dbName });
    await client.connect();

    try {
        await ensureMigrationsTable(client);

        const applied = await appliedMigrations(client);

        const migrationsDir = path.resolve(__dirname, '../migrations');
        const files = fs.readdirSync(migrationsDir)
            .filter(f => f.endsWith('.js'))
            .sort();

        const pending = files.filter(f => !applied.has(f));

        if (pending.length === 0) {
            console.log('Migrations: nothing to run.');
            return;
        }

        console.log(`Migrations: running ${pending.length} pending...`);

        for (const file of pending) {
            const filePath = pathToFileURL(path.join(migrationsDir, file)).href;
            const mod = await import(filePath);
            if (typeof mod.up !== 'function') {
                throw new Error(`Migration ${file} must export an "up" function`);
            }
            await runMigration(client, file, mod.up);
        }

        console.log('Migrations: done.');
    } catch (err) {
        console.error('Migrations failed:', err?.message || err);
        process.exit(1);
    } finally {
        await client.end();
    }
}

main();
