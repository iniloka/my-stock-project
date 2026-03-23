// netlify/functions/stockInfo.js
const fetch = require('node-fetch'); // Netlify 環境建議保留

let cache = { data: null, timestamp: 0 };
const CACHE_DURATION = 1000 * 60 * 30; // 30分鐘快取

exports.handler = async function(event, context) {
    const stockId = event.queryStringParameters.id;
    if (!stockId) return createResponse(400, { error: '請提供代號' });

    const now = Date.now();
    try {
        // --- 1. 同時抓取 上市(TWSE) 與 上櫃(TPEx) 的 API ---
        const urls = [
            'https://openapi.twse.com.tw/v1/exchangeReport/BWIBBU_ALL', // 上市基本面
            'https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_AVG_ALL', // 上市價格
            'https://www.tpex.org.tw/openapi/v1/tpex_mainboard_peratio_analysis', // 上櫃基本面
            'https://www.tpex.org.tw/openapi/v1/tpex_mainboard_quotes' // 上櫃價格
        ];

        let results;
        if (cache.data && (now - cache.timestamp < CACHE_DURATION)) {
            results = cache.data;
        } else {
            const responses = await Promise.all(urls.map(url => fetch(url).then(r => r.json())));
            results = {
                twseInfo: responses[0],
                twsePrice: responses[1],
                otcInfo: responses[2],
                otcPrice: responses[3]
            };
            cache.data = results;
            cache.timestamp = now;
        }

        // --- 2. 搜尋資料 (先找上市，找不到再找上櫃) ---
        let finalData = {};
        
        // 尋找上市
        const tInfo = results.twseInfo.find(s => s.Code === stockId);
        const tPrice = results.twsePrice.find(s => s.Code === stockId);
        
        if (tInfo && tPrice) {
            const p = parseFloat(tPrice.ClosingPrice.replace(/,/g, ''));
            finalData = {
                id: stockId,
                name: tInfo.Name,
                price: p,
                pe: tInfo.PEratio,
                yield: tInfo.DividendYield,
                pb: tInfo.PBratio
            };
        } else {
            // 尋找上櫃
            const oInfo = results.otcInfo.find(s => s.SecuritiesCompanyCode === stockId);
            const oPrice = results.otcPrice.find(s => s.Date && s.SecuritiesCompanyCode === stockId);
            
            if (oInfo && oPrice) {
                const p = parseFloat(oPrice.Close);
                finalData = {
                    id: stockId,
                    name: oInfo.CompanyName,
                    price: p,
                    pe: oInfo.PriceEarningsRatio,
                    yield: oInfo.DividendYield,
                    pb: oInfo.PriceBookRatio
                };
            }
        }

        if (!finalData.name) return createResponse(404, { error: '找不到該股票代號 (上市/上櫃)' });

        // --- 3. 計算策略與 EPS ---
        const pe = parseFloat(finalData.pe) || 0;
        finalData.eps = pe > 0 ? (finalData.price / pe).toFixed(2) : "N/A";
        finalData.suggestedBuy = (finalData.price * 0.95).toFixed(1);
        finalData.suggestedStop = (finalData.price * 0.88).toFixed(1);
        // 法人資料部分建議先預設，或視需要再增加 API
        finalData.foreign = "查詢中"; finalData.trust = "查詢中"; finalData.dealer = "查詢中";

        return createResponse(200, finalData);

    } catch (error) {
        return createResponse(500, { error: '後端執行失敗', details: error.message });
    }
};

function createResponse(code, body) {
    return { statusCode: code, headers: { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" }, body: JSON.stringify(body) };
}
