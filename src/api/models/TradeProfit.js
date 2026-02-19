import { DataTypes } from 'sequelize';

export function defineTradeProfit(sequelize) {
  return sequelize.define(
    'trade_profit',
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      trade_instance_id: { type: DataTypes.INTEGER, allowNull: true },
      name: { type: DataTypes.STRING(255), allowNull: true },
      pair: { type: DataTypes.STRING(255), allowNull: false },
      profit: { type: DataTypes.STRING(255), allowNull: false }, // consider restricting to BUY/SELL
      value: { type: DataTypes.REAL, allowNull: false },
      target_percent: { type: DataTypes.REAL, allowNull: true },
      fee: { type: DataTypes.DOUBLE, allowNull: true },
      price_intermediate: { type: DataTypes.DOUBLE, allowNull: true },
      price_final: { type: DataTypes.DOUBLE, allowNull: true },
      date_transaction: { type: DataTypes.DATE, allowNull: true },
    },
    { tableName: 'trade_profit', timestamps: false },
  );
}
