import { DataTypes } from 'sequelize';

export function defineTradeInstance(sequelize) {
  return sequelize.define(
    'trade_instance',
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, allowNull: false },

      name: { type: DataTypes.STRING(255), allowNull: true },
      folder: { type: DataTypes.STRING(255), allowNull: true },

      wallet_address: { type: DataTypes.STRING(255), allowNull: true },
      private_key: { type: DataTypes.STRING(255), allowNull: true },

      mail_to: { type: DataTypes.STRING(255), allowNull: true },
    },
    {
      tableName: 'trade_instance',
      timestamps: false,
    },
  );
}
