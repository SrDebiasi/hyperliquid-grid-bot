// src/reports/profitRepo.js
import { Op } from 'sequelize';

async function findProfitRowsForPeriod({ models, tradeInstanceId, period }) {
    return models.TradeProfit.findAll({
        where: {
            trade_instance_id: tradeInstanceId,
            date_transaction: {
                [Op.gte]: period.fromUtc,
                [Op.lt]: period.toUtc,
            },
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
