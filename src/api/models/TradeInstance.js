import { DataTypes } from 'sequelize';

export function defineTradeInstance(sequelize) {
  return sequelize.define(
    'trade_instance',
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, allowNull: false },

      name:           { type: DataTypes.STRING(255), allowNull: true },
      wallet_address: { type: DataTypes.STRING(255), allowNull: true },
      private_key:    { type: DataTypes.STRING(255), allowNull: true },
      mail_to:        { type: DataTypes.STRING(255), allowNull: true },

      // per-instance runtime settings (DB takes priority over .env)
      telegram_bot_token:            { type: DataTypes.STRING(255), allowNull: true },
      telegram_chat_id:              { type: DataTypes.STRING(255), allowNull: true },
      healthchecks_ping_url:         { type: DataTypes.STRING(500), allowNull: true },
      healthchecks_ping_interval_ms: { type: DataTypes.INTEGER,     allowNull: true },
      bot_tz:                        { type: DataTypes.STRING(100), allowNull: true },
      hyperliquid_testnet:           { type: DataTypes.BOOLEAN,     allowNull: true },

      // grid config
      pair:           { type: DataTypes.STRING(255), allowNull: true },

      target_percent:  { type: DataTypes.DECIMAL(10, 4), allowNull: true },
      margin_percent:  { type: DataTypes.DECIMAL(10, 4), allowNull: true },

      decimal_price:    { type: DataTypes.INTEGER, allowNull: true },
      decimal_quantity: { type: DataTypes.INTEGER, allowNull: true },

      execution_price_min: { type: DataTypes.REAL, allowNull: true },
      execution_price_max: { type: DataTypes.REAL, allowNull: true },

      reserve_quote_offset_percent: { type: DataTypes.DECIMAL(24, 12), allowNull: false, defaultValue: 30 },
      reserve_quote_order_id:       { type: DataTypes.STRING(64), allowNull: true },
      reserve_base_offset_percent:  { type: DataTypes.DECIMAL(24, 12), allowNull: false, defaultValue: 30 },
      reserve_base_order_id:        { type: DataTypes.STRING(64), allowNull: true },

      rebuy_profit:   { type: DataTypes.BOOLEAN, allowNull: true },
      rebuy_percent:  { type: DataTypes.DECIMAL(24, 12), allowNull: true },
      rebuy_value:    { type: DataTypes.DECIMAL(24, 12), allowNull: true },
      rebought_value: { type: DataTypes.DECIMAL(24, 12), allowNull: true },
      rebought_coin:  { type: DataTypes.DECIMAL(24, 12), allowNull: true },
    },
    {
      tableName: 'trade_instance',
      timestamps: false,
    },
  );
}
