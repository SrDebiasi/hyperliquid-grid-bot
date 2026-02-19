// src/reports/profitRepo.js
import { Op, Sequelize } from 'sequelize';

async function findProfitRowsForPeriod({ models, tradeInstanceId, period }) {
    return models.TradeProfit.findAll({
        where: {
            trade_instance_id: tradeInstanceId,
            [Op.and]: [
                Sequelize.where(
                    Sequelize.fn('DATE', Sequelize.col('date_transaction')),
                    { [Op.between]: [period.from, period.to] }
                ),
            ],
        },
        order: [['date_transaction', 'ASC']],
    });
}

async function findAllProfitRows({ models, tradeInstanceId }) {
    return models.TradeProfit.findAll({
        where: { trade_instance_id: tradeInstanceId },
        order: [['date_transaction', 'ASC']],
    });
}

export { findProfitRowsForPeriod, findAllProfitRows };
