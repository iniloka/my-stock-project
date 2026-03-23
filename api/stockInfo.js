// api/stockInfo.js
let cache = { data: null, timestamp: 0 };
const CACHE_DURATION = 1000 * 60 * 30; // 30分鐘快取，省流量

export default async function handler(req, res) {
    // 允許跨域連線
    res.setHeader('Access-Control-Allow-Origin', '*');

    // Vercel 抓取代號的語法
    const stockId = req.query.id;
    if (!stockId) return res.status(400).json({ error: '請提供股票代號' });

    const now = Date.now();
    try {
        if (!cache.data || (now - cache.timestamp > CACHE_DURATION)) {
            const [twseInfo, twsePrice, otcInfo, otcPrice] = await Promise.all([
                fetch('https://openapi.twse.com.tw/v1/exchangeReport/BWIBBU_ALL').then(r => r.json()),
                fetch('https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_AVG_ALL').then(r => r.json()),
                fetch('https://www.tpex.org.tw/openapi/v1/tpex_mainboard_peratio_analysis').then(r => r.json()),
                fetch('https://www.tpex.org.tw/openapi/v1/tpex_mainboard_quotes').then(r => r.json())
            ]);
            cache.data = { twseInfo, twsePrice, otcInfo, otcPrice };
            cache.timestamp = now;
        }

        const results = cache.data;
        let finalData = {};

        const tInfo = results.twseInfo.find(s => s.Code === stockId);
        const tPrice = results.twsePrice.find(s => s.Code === stockId);

        if (tInfo && tPrice) {
            finalData = {
                id: stockId, name: tInfo.Name, 
                price: parseFloat(tPrice.ClosingPrice.replace(/,/g, '')),
                pe: parseFloat(tInfo.PEratio) || 0, 
                yield: tInfo.DividendYield || "0", pb: tInfo.PBratio || "0"
            };
        } else {
            const oInfo = results.otcInfo.find(s => s.SecuritiesCompanyCode === stockId);
            const oPrice = results.otcPrice.find(s => s.Date && s.SecuritiesCompanyCode === stockId);
            if (oInfo && oPrice) {
                finalData = {
                    id: stockId, name: oInfo.CompanyName, 
                    price: parseFloat(oPrice.Close),
                    pe: parseFloat(oInfo.PriceEarningsRatio) || 0, 
                    yield: oInfo.DividendYield || "0", pb: oInfo.PriceBookRatio || "0"
                };
            }
        }

        if (!finalData.name) return res.status(404).json({ error: '找不到該股票代號' });

        const pe = finalData.pe;
        const price = finalData.price;
        finalData.eps = pe > 0 ? (price / pe).toFixed(2) : "N/A";
        finalData.suggestedBuy = (price * 0.95).toFixed(2);
        finalData.suggestedStop = (price * 0.88).toFixed(2);
        finalData.foreign = "-"; finalData.trust = "-"; finalData.dealer = "-";

        if (stockId === "2330") {
            finalData.score = "優 (🌟🌟🌟🌟🌟)";
            finalData.grossMargin = "59.89%";
            finalData.debtRatio = "38.2%";
            finalData.highlight = "AI 晶片需求強勁，CoWoS 產能滿載。";
            finalData.buyRange = "1,450 ~ 1,650 元";
            finalData.sellRange = "1,980 元以上";
        } else {
            if (pe > 0 && pe < 15) finalData.score = "優 (🌟🌟🌟🌟🌟)";
            else if (pe >= 15 && pe <= 25) finalData.score = "良 (🌟🌟🌟🌟)";
            else finalData.score = "普 (🌟🌟🌟)";

            finalData.grossMargin = "請參閱最新季報";
            finalData.debtRatio = "請參閱最新季報";
            finalData.highlight = `目前本益比約為 ${pe} 倍，請留意近期營收動能。`;

            if (pe > 0) {
                let epsNum = price / pe;
                finalData.buyRange = `${Math.floor(epsNum * 12)} ~ ${Math.floor(epsNum * 15)} 元`;
                finalData.sellRange = `${Math.floor(epsNum * 22)} 元以上`;
            } else {
                finalData.buyRange = "無法估算"; finalData.sellRange = "無法估算";
            }
        }

        // Vercel 回傳資料的語法
        return res.status(200).json(finalData);

    } catch (error) {
        return res.status(500).json({ error: '伺服器執行出錯' });
    }
}