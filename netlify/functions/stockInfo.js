// netlify/functions/stockInfo.js
let cache = { data: null, timestamp: 0 };
const CACHE_DURATION = 1000 * 60 * 60; 

exports.handler = async function(event, context) {
    const stockId = event.queryStringParameters.id;
    if (!stockId) return createResponse(400, { error: '請提供代號' });

    const now = Date.now();
    try {
        // 1. 抓取包含「收盤價」的 OpenAPI (每日收盤行情)
        const priceUrl = 'https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_AVG_ALL';
        // 2. 抓取包含「本益比、殖利率」的 OpenAPI
        const infoUrl = 'https://openapi.twse.com.tw/v1/exchangeReport/BWIBBU_ALL';

        let allPrices, allInfos;

        if (cache.data && (now - cache.timestamp < CACHE_DURATION)) {
            allPrices = cache.data.prices;
            allInfos = cache.data.infos;
        } else {
            const [resP, resI] = await Promise.all([fetch(priceUrl), fetch(infoUrl)]);
            allPrices = await resP.json();
            allInfos = await resI.json();
            cache.data = { prices: allPrices, infos: allInfos };
            cache.timestamp = now;
        }

        const priceData = allPrices.find(s => s.Code === stockId);
        const infoData = allInfos.find(s => s.Code === stockId);

        if (!priceData || !infoData) return createResponse(404, { error: '找不到該股票資料' });

        const currentPrice = parseFloat(priceData.ClosingPrice.replace(/,/g, ''));
        
        // --- 核心策略計算 ---
        // 1. 進場點：設在收盤價回檔 3% ~ 5% 的支撐區間 (分批買點)
        const buyPoint = (currentPrice * 0.96).toFixed(2); 
        // 2. 止損點：設在進場點再跌 7% (嚴格執行)
        const stopLoss = (currentPrice * 0.90).toFixed(2);

        return createResponse(200, {
            id: stockId,
            name: infoData.Name,
            price: currentPrice,
            pe: infoData.PEratio,
            yield: infoData.DividendYield,
            pb: infoData.PBratio,
            suggestedBuy: buyPoint,
            suggestedStop: stopLoss
        });

    } catch (error) {
        return createResponse(500, { error: '連線證交所失敗' });
    }
};

function createResponse(code, body) {
    return { statusCode: code, headers: { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" }, body: JSON.stringify(body) };
}
