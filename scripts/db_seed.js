import 'dotenv/config';
import pg from 'pg';

const { Client } = pg;

function required(name, value) {
    if (!value) throw new Error(`Missing env var: ${name}`);
    return value;
}

async function withTransaction(client, fn) {
    await client.query('BEGIN');
    try {
        const res = await fn();
        await client.query('COMMIT');
        return res;
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
    }
}

async function getOrCreateTradeInstance(client) {
    const instanceName = 'BTC';

    const existing = await client.query(
        `SELECT id FROM trade_instance LIMIT 1`
    );

    if (existing.rowCount > 0) {
        const id = existing.rows[0].id;
        console.log(`trade_instance already exists (id=${id}), skipping seed.`);
        return id;
    }

    // trade_instance.id is NOT identity, so we generate it.
    const nextIdRes = await client.query(
        `SELECT COALESCE(MAX(id), 0) + 1 AS next_id FROM trade_instance`
    );
    const nextId = Number(nextIdRes.rows[0].next_id);

    const inserted = await client.query(
        `INSERT INTO trade_instance (
            id, name, wallet_address, private_key, mail_to,
            pair,
            target_percent,
            margin_percent,
            decimal_quantity,
            decimal_price,
            rebuy_profit,
            reserve_quote_offset_percent,
            reserve_quote_order_id,
            reserve_base_offset_percent,
            reserve_base_order_id,
            rebuy_percent,
            rebuy_value,
            rebought_value,
            rebought_coin,
            execution_price_min,
            execution_price_max
        ) VALUES (
            $1,$2,$3,$4,$5,
            $6,$7,$8,$9,$10,$11,
            $12,$13,$14,$15,
            $16,$17,$18,$19,$20,$21
        ) RETURNING id`,
        [
            nextId, instanceName, '', '', '',
            'BTC/USDC',  // pair
            1.8,         // target_percent
            0.1,         // margin_percent
            5,           // decimal_quantity
            0,           // decimal_price
            true,        // rebuy_profit
            30,          // reserve_quote_offset_percent
            null,        // reserve_quote_order_id
            30,          // reserve_base_offset_percent
            null,        // reserve_base_order_id
            50,          // rebuy_percent
            0,           // rebuy_value
            null,        // rebought_value
            null,        // rebought_coin
            60000,       // execution_price_min
            100000,      // execution_price_max
        ]
    );

    const id = inserted.rows[0].id;
    console.log(`Inserted trade_instance id=${id} name="${instanceName}"`);
    return id;
}

async function main() {
    const host = required('DB_HOST', process.env.DB_HOST);
    const port = Number(process.env.DB_PORT || '5432');
    const dbName = required('DB_NAME', process.env.DB_NAME);
    const user = required('DB_USER', process.env.DB_USER);
    const password = process.env.DB_PASS || '';

    const client = new Client({ host, port, user, password, database: dbName });
    await client.connect();

    try {
        await withTransaction(client, async () => {
            await getOrCreateTradeInstance(client);
        });

        console.log('Seed completed.');
    } catch (err) {
        console.error('db:seed failed:', err?.message || err);
        process.exit(1);
    } finally {
        await client.end();
    }
}

main();
