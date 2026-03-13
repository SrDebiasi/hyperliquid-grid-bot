import { DataTypes } from 'sequelize';

export function defineTradeCycle(sequelize) {
  return sequelize.define(
    'trade_cycle',
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      trade_instance_id: { type: DataTypes.INTEGER, allowNull: true },
      name: { type: DataTypes.STRING(255), allowNull: true },
      pair: { type: DataTypes.STRING(255), allowNull: false },
      side: { type: DataTypes.STRING(255), allowNull: false },
      price: { type: DataTypes.DOUBLE, allowNull: true },
      date_transaction: { type: DataTypes.DATE, allowNull: true },
      date_transaction_utc: { type: DataTypes.DATE, allowNull: true },
    },
    { tableName: 'trade_cycle', timestamps: false },
  );
}
