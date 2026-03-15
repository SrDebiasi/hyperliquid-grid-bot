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

async function getOrCreateTradeInstanceId(client) {
    const instanceName = 'BTC';

    const existing = await client.query(
        `SELECT id FROM trade_instance WHERE name = $1 LIMIT 1`,
        [instanceName]
    );

    if (existing.rowCount > 0) {
        const id = existing.rows[0].id;
        console.log(`Using existing trade_instance name="${instanceName}" id=${id}`);
        return id;
    }

    // trade_instance.id is NOT identity, so we generate it.
    const nextIdRes = await client.query(
        `SELECT COALESCE(MAX(id), 0) + 1 AS next_id FROM trade_instance`
    );
    const nextId = Number(nextIdRes.rows[0].next_id);

    const inserted = await client.query(
        `INSERT INTO trade_instance (id, name, wallet_address, private_key, mail_to)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
        [nextId, instanceName, '', '', '']
    );

    const id = inserted.rows[0].id;
    console.log(`Inserted trade_instance id=${id} name="${instanceName}"`);
    return id;
}

async function seedDefaultTradeConfig(client, tradeInstanceId) {
    const configName = 'BTC';

    const exists = await client.query(
        `SELECT id FROM trade_config
     WHERE trade_instance_id = $1 AND name = $2
     LIMIT 1`,
        [tradeInstanceId, configName]
    );

    if (exists.rowCount > 0) {
        console.log(
            `trade_config already exists for trade_instance_id=${tradeInstanceId} name="${configName}", skipping`
        );
        return;
    }

    const inserted = await client.query(
        `INSERT INTO trade_config (
            pair,
            target_percent,
            margin_percent,
            decimal_quantity,
            decimal_price,
            trade_instance_id,
            name,
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
                     $1,$2,$3,$4,$5,$6,$7,$8,
                     $9,$10,$11,$12,
                     $13,$14,$15,$16,$17,$18
                 )
             RETURNING id`,
        [
            'BTC/USDC',      // pair
            1.8,             // target_percent
            0.1,             // margin_percent
            5,               // decimal_quantity
            0,               // decimal_price
            tradeInstanceId, // trade_instance_id
            'BTC',           // name
            true,            // rebuy_profit

            30,              // reserve_quote_offset_percent
            null,            // reserve_quote_order_id
            30,              // reserve_base_offset_percent
            null,            // reserve_base_order_id

            50,              // rebuy_percent
            0,               // rebuy_value
            null,            // rebought_value
            null,            // rebought_coin
            60000,           // execution_price_min
            100000,          // execution_price_max
        ],
    );

    console.log(
        `Inserted trade_config id=${inserted.rows[0].id} for trade_instance_id=${tradeInstanceId}`
    );
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
            const tradeInstanceId = await getOrCreateTradeInstanceId(client);
            await seedDefaultTradeConfig(client, tradeInstanceId);
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
