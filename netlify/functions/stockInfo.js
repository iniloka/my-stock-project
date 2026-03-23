// netlify/functions/stockInfo.js

let cache = { data: null, timestamp: 0 };
const CACHE_DURATION = 1000 * 60 * 30; // 30分鐘快取

export const handler = async (event) => {
    const stockId = event.queryStringParameters.id;
    if (!stockId) return createResponse(400, { error: '請提供代號' });

    const now = Date.now();
    try {
        let results;

        // 檢查快取
        if (cache.data && (now - cache.timestamp < CACHE_DURATION)) {
            results = cache.data;
        } else {
            // 這裡直接使用內建 fetch，不用 require
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

        // 搜尋上市或上櫃資料
        let finalData = {};
        const tInfo = results.twseInfo.find(s => s.Code === stockId);
        const tPrice = results.twsePrice.find(s => s.Code === stockId);

        if (tInfo && tPrice) {
            const p = parseFloat(tPrice.ClosingPrice.replace(/,/g, ''));
            finalData = {
                id: stockId, name: tInfo.Name, price: p,
                pe: tInfo.PEratio, yield: tInfo.DividendYield, pb: tInfo.PBratio
            };
        } else {
            const oInfo = results.otcInfo.find(s => s.SecuritiesCompanyCode === stockId);
            const oPrice = results.otcPrice.find(s => s.Date && s.SecuritiesCompanyCode === stockId);
            if (oInfo && oPrice) {
                const p = parseFloat(oPrice.Close);
                finalData = {
                    id: stockId, name: oInfo.CompanyName, price: p,
                    pe: oInfo.PriceEarningsRatio, yield: oInfo.DividendYield, pb: oInfo.PriceBookRatio
                };
            }
        }

        if (!finalData.name) {
            return createResponse(404, { error: '找不到該股票 (上市或上櫃皆無此代號)' });
        }

        // 計算建議與 EPS
        const pe = parseFloat(finalData.pe) || 0;
        finalData.eps = pe > 0 ? (finalData.price / pe).toFixed(2) : "N/A";
        finalData.suggestedBuy = (finalData.price * 0.95).toFixed(1);
        finalData.suggestedStop = (finalData.price * 0.88).toFixed(1);
        
        // 預設法人資訊 (若需實時法人，建議未來再擴充)
        finalData.foreign = "查詢中"; finalData.trust = "查詢中"; finalData.dealer = "查詢中";

        return createResponse(200, finalData);

    } catch (error) {
        console.error("Function Error:", error);
        return createResponse(500, { error: '後端執行出錯', msg: error.message });
    }
};

function createResponse(code, body) {
    return {
        statusCode: code,
        headers: {
            "Access-Control-Allow-Origin": "*",
            "Content-Type": "application/json"
        },
        body: JSON.stringify(body)
    };
}
