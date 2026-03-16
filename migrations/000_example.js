/**
 * Example migration — no schema changes.
 * Runs a harmless SELECT to confirm the migration runner is working.
 */
export async function up(client) {
    const res = await client.query('SELECT COUNT(*) AS total FROM schema_migrations');
    console.log(`    (example migration ok — schema_migrations has ${res.rows[0].total} row(s) so far)`);
}
