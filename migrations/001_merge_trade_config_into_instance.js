export async function up(client) {
    // 1. Add all trade_config columns to trade_instance
    await client.query(`
        ALTER TABLE trade_instance
            ADD COLUMN IF NOT EXISTS pair                        varchar(255),
            ADD COLUMN IF NOT EXISTS target_percent              real,
            ADD COLUMN IF NOT EXISTS margin_percent              real,
            ADD COLUMN IF NOT EXISTS decimal_quantity            integer,
            ADD COLUMN IF NOT EXISTS decimal_price               integer,
            ADD COLUMN IF NOT EXISTS execution_price_min         real NOT NULL DEFAULT 0,
            ADD COLUMN IF NOT EXISTS execution_price_max         real NOT NULL DEFAULT 0,
            ADD COLUMN IF NOT EXISTS reserve_quote_offset_percent real NOT NULL DEFAULT 30,
            ADD COLUMN IF NOT EXISTS reserve_quote_order_id      varchar(20),
            ADD COLUMN IF NOT EXISTS reserve_base_offset_percent  real NOT NULL DEFAULT 30,
            ADD COLUMN IF NOT EXISTS reserve_base_order_id       varchar(20),
            ADD COLUMN IF NOT EXISTS rebuy_profit                boolean,
            ADD COLUMN IF NOT EXISTS rebuy_percent               integer,
            ADD COLUMN IF NOT EXISTS rebuy_value                 real,
            ADD COLUMN IF NOT EXISTS rebought_value              real,
            ADD COLUMN IF NOT EXISTS rebought_coin               real
    `);

    // 2. Copy data from trade_config into trade_instance
    await client.query(`
        UPDATE trade_instance ti
        SET
            pair                         = tc.pair,
            target_percent               = tc.target_percent,
            margin_percent               = tc.margin_percent,
            decimal_quantity             = tc.decimal_quantity,
            decimal_price                = tc.decimal_price,
            execution_price_min          = tc.execution_price_min,
            execution_price_max          = tc.execution_price_max,
            reserve_quote_offset_percent = tc.reserve_quote_offset_percent,
            reserve_quote_order_id       = tc.reserve_quote_order_id,
            reserve_base_offset_percent  = tc.reserve_base_offset_percent,
            reserve_base_order_id        = tc.reserve_base_order_id,
            rebuy_profit                 = tc.rebuy_profit,
            rebuy_percent                = tc.rebuy_percent,
            rebuy_value                  = tc.rebuy_value,
            rebought_value               = tc.rebought_value,
            rebought_coin                = tc.rebought_coin
        FROM trade_config tc
        WHERE tc.trade_instance_id = ti.id
    `);

    // 3. Drop trade_config (FK constraint removed automatically with the table)
    await client.query(`DROP TABLE IF EXISTS trade_config`);
}
