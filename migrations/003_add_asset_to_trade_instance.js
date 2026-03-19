export async function up(client) {
    // Add asset column (the ticker symbol, e.g. "BTC") separate from name (free-form label)
    await client.query(`
        ALTER TABLE trade_instance
            ADD COLUMN IF NOT EXISTS asset varchar(255)
    `);

    // Backfill: extract the first word of name (uppercased) as the asset ticker
    // e.g. "BTC Carlos" -> "BTC", "BTC" -> "BTC"
    await client.query(`
        UPDATE trade_instance
        SET asset = UPPER(SPLIT_PART(TRIM(name), ' ', 1))
        WHERE asset IS NULL AND name IS NOT NULL AND TRIM(name) <> ''
    `);
}
