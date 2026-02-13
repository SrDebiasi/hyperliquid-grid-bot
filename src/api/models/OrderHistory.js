import { DataTypes } from "sequelize";

export function defineOrderHistory(sequelize) {
    return sequelize.define(
        "order_history",
        {
            id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
            pair: { type: DataTypes.STRING(255), allowNull: true },
            trade_instance_id: { type: DataTypes.INTEGER, allowNull: true },
            order_id: { type: DataTypes.STRING(255), allowNull: true },
            side: { type: DataTypes.STRING(16), allowNull: true },
            price: { type: DataTypes.DOUBLE, allowNull: true },
            quantity: { type: DataTypes.DOUBLE, allowNull: true },
            status: { type: DataTypes.STRING(32), allowNull: true },
            created_at: { type: DataTypes.DATE, allowNull: true },
        },
        { tableName: "order_history", timestamps: false }
    );
}
