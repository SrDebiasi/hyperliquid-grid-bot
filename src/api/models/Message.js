import { DataTypes } from "sequelize";

export function defineMessage(sequelize) {
    return sequelize.define(
        "message",
        {
            id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
            message: { type: DataTypes.TEXT, allowNull: true },
            date: { type: DataTypes.DATE, allowNull: true },
        },
        { tableName: "message", timestamps: false }
    );
}
