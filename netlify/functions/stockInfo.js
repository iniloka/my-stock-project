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

        if (!finalData.name) return createResponse(404, { error: '找不到該股票 (上市/上櫃皆無此代號)' });

        // 計算 EPS 與進出場區間 (歷史估值法模擬)
        const pe = parseFloat(finalData.pe) || 0;
        let epsNum = 0;
        finalData.eps = "N/A";
        finalData.buyRange = "需自行評估";
        finalData.sellRange = "需自行評估";

        if (pe > 0) {
            epsNum = finalData.price / pe;
            finalData.eps = epsNum.toFixed(2);
            // 模擬歷史估值法：便宜價約 12-15 倍 PE，昂貴價約 22 倍 PE 以上
            finalData.buyRange = `${Math.floor(epsNum * 12)} ~ ${Math.floor(epsNum * 15)} 元`;
            finalData.sellRange = `${Math.floor(epsNum * 22)} 元以上`;
        }

        // 模擬財報數據版位 (因免費 API 無此資料，先以文字或預設值佔位)
        finalData.grossMargin = "請串接季報API";
        finalData.debtRatio = "請串接季報API";
        finalData.highlight = `目前股價 ${finalData.price} 元，市場給予的本益比為 ${finalData.pe} 倍。請持續關注下個月營收表現與法人籌碼動向。`;

        return createResponse(200, finalData);

    } catch (error) {
        return createResponse(500, { error: '伺服器執行出錯', msg: error.message });
    }
};

function createResponse(code, body) {
    return { statusCode: code, headers: { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" }, body: JSON.stringify(body) };
}
