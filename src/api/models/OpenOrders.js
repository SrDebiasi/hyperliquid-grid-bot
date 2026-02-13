import { DataTypes } from "sequelize";

export function defineOpenOrders(sequelize) {
    return sequelize.define(
        "open_orders",
        {
            id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
            pair: { type: DataTypes.STRING(255), allowNull: true },
            trade_instance_id: { type: DataTypes.INTEGER, allowNull: true },
            order_id: { type: DataTypes.STRING(255), allowNull: true },
            side: { type: DataTypes.STRING(16), allowNull: true },
            price: { type: DataTypes.DOUBLE, allowNull: true },
            quantity: { type: DataTypes.DOUBLE, allowNull: true },
            created_at: { type: DataTypes.DATE, allowNull: true },
        },
        { tableName: "open_orders", timestamps: false }
    );
}
