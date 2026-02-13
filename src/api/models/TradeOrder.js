import { DataTypes } from "sequelize";

export function defineTradeOrder(sequelize) {
    const TradeOrder = sequelize.define(
        "trade_order",
        {
            id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },

            buy_order: { type: DataTypes.STRING(255), allowNull: true },
            sell_order: { type: DataTypes.STRING(255), allowNull: true },

            buy_price: { type: DataTypes.DOUBLE, allowNull: true },
            sell_price: { type: DataTypes.DOUBLE, allowNull: true },
            quantity: { type: DataTypes.DOUBLE, allowNull: true },

            pair: { type: DataTypes.STRING(255), allowNull: true },
            trade_instance_id: { type: DataTypes.INTEGER, allowNull: true },

            last_operation: { type: DataTypes.BOOLEAN, allowNull: true },
            last_side: { type: DataTypes.STRING(255), allowNull: true },

            entry_price: { type: DataTypes.DOUBLE, allowNull: true },
            first_profit: { type: DataTypes.DOUBLE, allowNull: true },
        },
        {
            tableName: "trade_order",
            timestamps: false,
        }
    );

    return TradeOrder;
}
