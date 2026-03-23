// api/stockInfo.js
let cache = { list: null, timestamp: 0 };
const CACHE_DURATION = 1000 * 60 * 60 * 12; // 名單快取 12 小時

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET');

    const query = req.query.id;
    if (!query) return res.status(400).json({ error: '請提供股票代號或名稱' });

    const searchQ = query.trim().toUpperCase();

    try {
        // 1. 先抓取台灣上市櫃名單 (用來比對中文名稱與判斷上市/上櫃)
        if (!cache.list || (Date.now() - cache.timestamp > CACHE_DURATION)) {
            const [twse, tpex] = await Promise.all([
                fetch('https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL').then(r => r.json()),
                fetch('https://www.tpex.org.tw/openapi/v1/tpex_mainboard_quotes').then(r => r.json())
            ]);
            cache.list = { twse, tpex };
            cache.timestamp = Date.now();
        }

        let stockId = searchQ;
        let suffix = '.TW'; // 預設為上市

        const tMatch = cache.list.twse.find(s => s.Code === searchQ || s.Name.includes(searchQ));
        if (tMatch) {
            stockId = tMatch.Code;
            suffix = '.TW';
        } else {
            const oMatch = cache.list.tpex.find(s => s.SecuritiesCompanyCode === searchQ || s.CompanyName.includes(searchQ));
            if (oMatch) {
                stockId = oMatch.SecuritiesCompanyCode;
                suffix = '.TWO'; // 這是 Yahoo Finance 專用的上櫃代號
            } else if (!/^\d{4,6}$/.test(searchQ)) {
                return res.status(404).json({ error: '找不到該股票，請確認名稱' });
            }
        }

        // 2. 核心大絕招：向 Yahoo Finance 索取真實財報數據
        const yfUrl = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${stockId}${suffix}`;
        const yfRes = await fetch(yfUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        const yfData = await yfRes.json();

        if (!yfData.quoteResponse || !yfData.quoteResponse.result || yfData.quoteResponse.result.length === 0) {
            return res.status(404).json({ error: '國際資料庫查無此代號' });
        }

        const data = yfData.quoteResponse.result[0];

        // 3. 整理真實數據 (完全不經過政府蓋牌)
        const price = data.regularMarketPrice || 0;
        const eps = data.epsTrailingTwelveMonths; // 真實的近四季 EPS
        const pe = data.trailingPE;               // 真實本益比
        
        // 處理 Yahoo 的殖利率格式
        let yieldVal = "-";
        if (data.dividendYield) yieldVal = data.dividendYield.toFixed(2);
        else if (data.trailingAnnualDividendYield) yieldVal = (data.trailingAnnualDividendYield * 100).toFixed(2);

        let finalData = {
            id: stockId,
            name: data.longName || data.shortName || stockId,
            price: price,
            eps: eps !== undefined ? eps.toFixed(2) : "N/A",
            pe: pe !== undefined ? pe.toFixed(2) : NaN,
            yield: yieldVal,
            pb: data.priceToBook !== undefined ? data.priceToBook.toFixed(2) : "-"
        };

        // 狀態判定
        finalData.isETF = finalData.id.startsWith('00') || (isNaN(finalData.pe) && finalData.eps === "N/A");
        finalData.hasPE = !isNaN(finalData.pe) && finalData.pe > 0;
        
        finalData.suggestedBuy = (price * 0.95).toFixed(2);
        finalData.suggestedStop = (price * 0.88).toFixed(2);
        finalData.foreign = "-"; finalData.trust = "-"; finalData.dealer = "-";

        return res.status(200).json(finalData);

    } catch (error) {
        console.error("Backend Error:", error);
        return res.status(500).json({ error: '伺服器錯誤，無法抓取財報' });
    }
}
