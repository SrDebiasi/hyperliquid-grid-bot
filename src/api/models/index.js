import { defineTradeConfig } from "./TradeConfig.js";
import { defineTradeOrder } from "./TradeOrder.js";
import { defineTradeInstance } from "./TradeInstance.js";
import { defineTradeProfit } from "./TradeProfit.js";
import { defineTradeCycle } from "./TradeCycle.js";
import { defineMessage } from "./Message.js";
import { defineOpenOrders } from "./OpenOrders.js";
import { defineOrderHistory } from "./OrderHistory.js";

export function buildModels(sequelize) {
    const TradeConfig = defineTradeConfig(sequelize);
    const TradeOrder = defineTradeOrder(sequelize);
    const TradeInstance = defineTradeInstance(sequelize);
    const TradeProfit = defineTradeProfit(sequelize);
    const TradeCycle = defineTradeCycle(sequelize);
    const Message = defineMessage(sequelize);

    const OpenOrders = defineOpenOrders(sequelize);
    const OrderHistory = defineOrderHistory(sequelize);

    return {
        TradeConfig,
        TradeOrder,
        TradeInstance,
        TradeProfit,
        TradeCycle,
        Message,
        OpenOrders,
        OrderHistory,
    };
}
