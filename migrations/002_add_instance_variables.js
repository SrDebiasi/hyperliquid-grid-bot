export async function up(client) {
    await client.query(`
        ALTER TABLE trade_instance
            ADD COLUMN IF NOT EXISTS telegram_bot_token           varchar(255),
            ADD COLUMN IF NOT EXISTS telegram_chat_id            varchar(255),
            ADD COLUMN IF NOT EXISTS healthchecks_ping_url        varchar(500),
            ADD COLUMN IF NOT EXISTS healthchecks_ping_interval_ms integer,
            ADD COLUMN IF NOT EXISTS bot_tz                      varchar(100),
            ADD COLUMN IF NOT EXISTS hyperliquid_testnet         boolean
    `);
}
