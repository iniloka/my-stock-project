// api/stockInfo.js
let cache = { data: null, timestamp: 0 };
const CACHE_DURATION = 1000 * 60 * 15; // 15 分鐘快取，減輕伺服器負擔

export default async function handler(req, res) {
    // 允許前端跨域讀取
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET');

    const query = req.query.id;
    if (!query) return res.status(400).json({ error: '請提供股票代號或名稱' });

    const searchQ = query.trim().toUpperCase();
    const now = Date.now();

    try {
        // 1. 同時下載上市與上櫃資料庫
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

        const { twseInfo, twsePrice, otcInfo, otcPrice } = cache.data;
        let finalData = null;

        // 2. 搜尋上市 (支援代號與名稱)
        const tPriceMatch = twsePrice.find(s => s.Code === searchQ || s.Name.toUpperCase().includes(searchQ));
        if (tPriceMatch) {
            const code = tPriceMatch.Code;
            const tInfoMatch = twseInfo.find(s => s.Code === code);
            finalData = {
                id: code, name: tPriceMatch.Name,
                price: parseFloat(tPriceMatch.ClosingPrice.replace(/,/g, '')),
                pe: tInfoMatch ? parseFloat(tInfoMatch.PEratio) : NaN,
                yield: tInfoMatch ? tInfoMatch.DividendYield : "-",
                pb: tInfoMatch ? tInfoMatch.PBratio : "-"
            };
        } else {
            // 3. 搜尋上櫃 (支援代號與名稱)
            const oPriceMatch = otcPrice.find(s => s.SecuritiesCompanyCode === searchQ || s.CompanyName.toUpperCase().includes(searchQ));
            if (oPriceMatch) {
                const code = oPriceMatch.SecuritiesCompanyCode;
                const oInfoMatch = otcInfo.find(s => s.SecuritiesCompanyCode === code);
                finalData = {
                    id: code, name: oPriceMatch.CompanyName,
                    price: parseFloat(oPriceMatch.Close.replace(/,/g, '')),
                    pe: oInfoMatch ? parseFloat(oInfoMatch.PriceEarningsRatio) : NaN,
                    yield: oInfoMatch ? oInfoMatch.DividendYield : "-",
                    pb: oInfoMatch ? oInfoMatch.PriceBookRatio : "-"
                };
            }
        }

        if (!finalData) return res.status(404).json({ error: '找不到該股票或 ETF' });

        // 4. 計算與狀態判定
        const price = finalData.price || 0;
        const pe = finalData.pe;
        
        // 判定是否為 ETF (代號 00 開頭，或無本益比且無殖利率)
        finalData.isETF = finalData.id.startsWith('00') || (isNaN(pe) && finalData.yield === "-");
        // 判定是否有有效本益比 (排除 M31 虧損時的狀況)
        finalData.hasPE = !isNaN(pe) && pe > 0;

        finalData.suggestedBuy = (price * 0.95).toFixed(2);
        finalData.suggestedStop = (price * 0.88).toFixed(2);
        
        // 暫代法人籌碼
        finalData.foreign = "-"; finalData.trust = "-"; finalData.dealer = "-";

        return res.status(200).json(finalData);

    } catch (error) {
        console.error("Vercel Backend Error:", error);
        return res.status(500).json({ error: '伺服器向證交所抓取資料失敗' });
    }
}
