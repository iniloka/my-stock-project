// netlify/functions/stockInfo.js
let cache = { data: null, timestamp: 0 };
const CACHE_DURATION = 1000 * 60 * 30; // 縮短為 30 分鐘更新一次

exports.handler = async function(event, context) {
    const stockId = event.queryStringParameters.id;
    if (!stockId) return createResponse(400, { error: '請提供代號' });

    try {
        // 1. 抓取多個 API：收盤價、基本面、三大法人買賣超
        const priceUrl = 'https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_AVG_ALL';
        const infoUrl = 'https://openapi.twse.com.tw/v1/exchangeReport/BWIBBU_ALL';
        const institutionalUrl = 'https://openapi.twse.com.tw/v1/fund/T86_ALL'; // 三大法人

        const [resP, resI, resT] = await Promise.all([fetch(priceUrl), fetch(infoUrl), fetch(institutionalUrl)]);
        const allPrices = await resP.json();
        const allInfos = await resI.json();
        const allTrusts = await resT.json();

        const pData = allPrices.find(s => s.Code === stockId);
        const iData = allInfos.find(s => s.Code === stockId);
        const tData = allTrusts.find(s => s.Code === stockId);

        if (!pData || !iData) return createResponse(404, { error: '找不到資料，請確認是否為上市股票' });

        const price = parseFloat(pData.ClosingPrice.replace(/,/g, ''));
        const pe = parseFloat(iData.PEratio);
        
        // 估算 EPS (股價 / 本益比)
        const estEps = pe > 0 ? (price / pe).toFixed(2) : "N/A";

        return createResponse(200, {
            id: stockId,
            name: iData.Name,
            price: price,
            eps: estEps,
            pe: pe,
            yield: iData.DividendYield,
            pb: iData.PBratio,
            // 法人數據 (張數)
            foreign: tData ? tData.ForeignDealersBuySell : "0",
            trust: tData ? tData.InvestmentTrustBuySell : "0",
            dealer: tData ? tData.ProprietaryDealersBuySell : "0",
            suggestedBuy: (price * 0.96).toFixed(1),
            suggestedStop: (price * 0.90).toFixed(1)
        });
    } catch (e) {
        return createResponse(500, { error: 'API 連線失敗' });
    }
};

function createResponse(code, body) {
    return { statusCode: code, headers: { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" }, body: JSON.stringify(body) };
}
