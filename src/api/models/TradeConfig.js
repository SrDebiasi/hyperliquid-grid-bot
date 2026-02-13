import { DataTypes } from "sequelize";

export function defineTradeConfig(sequelize) {
    const TradeConfig = sequelize.define(
        "trade_config",
        {
            id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },

            trade_instance_id: { type: DataTypes.INTEGER, allowNull: false },
            pair: { type: DataTypes.STRING(32), allowNull: false },
            name: { type: DataTypes.STRING(64), allowNull: true },

            entry_price: { type: DataTypes.DECIMAL(24, 12), allowNull: true },
            exit_price: { type: DataTypes.DECIMAL(24, 12), allowNull: true },

            margin_percent: { type: DataTypes.DECIMAL(10, 4), allowNull: true },
            target_percent: { type: DataTypes.DECIMAL(10, 4), allowNull: true },

            usd_transaction: { type: DataTypes.DECIMAL(24, 8), allowNull: true },

            decimal_price: { type: DataTypes.INTEGER, allowNull: true },
            decimal_quantity: { type: DataTypes.INTEGER, allowNull: true },

            order_block_id: { type: DataTypes.STRING(64), allowNull: true },
            order_block_price: { type: DataTypes.DECIMAL(24, 12), allowNull: true },

            rebuy_profit: { type: DataTypes.BOOLEAN, allowNull: true },
            rebuy_percent: { type: DataTypes.DECIMAL(24, 12), allowNull: true },
            rebuy_value: { type: DataTypes.DECIMAL(24, 12), allowNull: true },
            rebought_value: { type: DataTypes.DECIMAL(24, 12), allowNull: true },
            rebought_coin: { type: DataTypes.DECIMAL(24, 12), allowNull: true },
        },
        {
            tableName: "trade_config",
            timestamps: false,
        }
    );

    return TradeConfig;
}
