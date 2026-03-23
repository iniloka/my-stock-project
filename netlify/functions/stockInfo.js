// netlify/functions/stockInfo.js
let cache = { data: null, timestamp: 0 };
const CACHE_DURATION = 1000 * 60 * 30; // 30分鐘快取

export const handler = async (event) => {
    const stockId = event.queryStringParameters.id;
    if (!stockId) return createResponse(400, { error: '請提供股票代號' });

    const now = Date.now();
    try {
        let results;
        if (cache.data && (now - cache.timestamp < CACHE_DURATION)) {
            results = cache.data;
        } else {
            const [twseInfo, twsePrice, otcInfo, otcPrice] = await Promise.all([
                fetch('https://openapi.twse.com.tw/v1/exchangeReport/BWIBBU_ALL').then(r => r.json()),
                fetch('https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_AVG_ALL').then(r => r.json()),
                fetch('https://www.tpex.org.tw/openapi/v1/tpex_mainboard_peratio_analysis').then(r => r.json()),
                fetch('https://www.tpex.org.tw/openapi/v1/tpex_mainboard_quotes').then(r => r.json())
            ]);
            results = { twseInfo, twsePrice, otcInfo, otcPrice };
            cache.data = results;
            cache.timestamp = now;
        }

        let finalData = {};
        const tInfo = results.twseInfo.find(s => s.Code === stockId);
        const tPrice = results.twsePrice.find(s => s.Code === stockId);

        if (tInfo && tPrice) {
            finalData = {
                id: stockId, name: tInfo.Name, 
                price: parseFloat(tPrice.ClosingPrice.replace(/,/g, '')),
                pe: tInfo.PEratio, yield: tInfo.DividendYield, pb: tInfo.PBratio
            };
        } else {
            const oInfo = results.otcInfo.find(s => s.SecuritiesCompanyCode === stockId);
            const oPrice = results.otcPrice.find(s => s.Date && s.SecuritiesCompanyCode === stockId);
            if (oInfo && oPrice) {
                finalData = {
                    id: stockId, name: oInfo.CompanyName, 
                    price: parseFloat(oPrice.Close),
                    pe: oInfo.PriceEarningsRatio, yield: oInfo.DividendYield, pb: oInfo.PriceBookRatio
                };
            }
        }

        if (!finalData.name) return createResponse(404, { error: '找不到該股票代號' });

        // 計算 EPS 與 具體進出場點位
        const pe = parseFloat(finalData.pe) || 0;
        finalData.eps = pe > 0 ? (finalData.price / pe).toFixed(2) : "N/A";
        
        // 具體數字建議：進場抓跌 5% 支撐，止損抓跌 12%
        finalData.suggestedBuy = (finalData.price * 0.95).toFixed(2);
        finalData.suggestedStop = (finalData.price * 0.88).toFixed(2);

        // 確保法人資料有回傳，避免前端當機
        finalData.foreign = "0";
        finalData.trust = "0";
        finalData.dealer = "0";

        return createResponse(200, finalData);

    } catch (error) {
        console.error("Backend Error:", error);
        return createResponse(500, { error: '後端執行出錯' });
    }
};

function createResponse(code, body) {
    return { statusCode: code, headers: { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" }, body: JSON.stringify(body) };
}
