// api/stockInfo.js
let cache = { data: null, timestamp: 0 };
const CACHE_DURATION = 1000 * 60 * 15; // 15分鐘快取

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET');

    const query = req.query.id;
    if (!query) return res.status(400).json({ error: '請提供代號或名稱' });

    const searchQ = query.trim().toUpperCase();
    const now = Date.now();

    try {
        if (!cache.data || (now - cache.timestamp > CACHE_DURATION)) {
            // 新增抓取 T86_ALL (上市三大法人)
            const [twseInfo, twsePrice, twseInst, otcInfo, otcPrice] = await Promise.all([
                fetch('https://openapi.twse.com.tw/v1/exchangeReport/BWIBBU_ALL').then(r => r.json()).catch(() => []),
                fetch('https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL').then(r => r.json()).catch(() => []),
                fetch('https://openapi.twse.com.tw/v1/fund/T86_ALL').then(r => r.json()).catch(() => []),
                fetch('https://www.tpex.org.tw/openapi/v1/tpex_mainboard_peratio_analysis').then(r => r.json()).catch(() => []),
                fetch('https://www.tpex.org.tw/openapi/v1/tpex_mainboard_quotes').then(r => r.json()).catch(() => [])
            ]);
            cache.data = { twseInfo, twsePrice, twseInst, otcInfo, otcPrice };
            cache.timestamp = now;
        }

        const { twseInfo, twsePrice, twseInst, otcInfo, otcPrice } = cache.data;
        let finalData = null;

        // 搜尋上市
        const tPriceMatch = twsePrice.find(s => s.Code === searchQ || (s.Name && s.Name.toUpperCase().includes(searchQ)));
        if (tPriceMatch) {
            const code = tPriceMatch.Code;
            const tInfoMatch = twseInfo.find(s => s.Code === code);
            const tInstMatch = twseInst.find(s => s.Code === code); // 抓取該檔股票的法人資料

            finalData = {
                id: code, name: tPriceMatch.Name, market: 'TWSE',
                price: parseFloat(tPriceMatch.ClosingPrice.replace(/,/g, '')),
                pe: tInfoMatch ? parseFloat(tInfoMatch.PEratio) : NaN,
                yield: tInfoMatch ? tInfoMatch.DividendYield : "-",
                pb: tInfoMatch ? tInfoMatch.PBratio : "-",
                // 將股數轉換為「張數」 (除以 1000)
                foreign: tInstMatch ? Math.round(parseFloat(tInstMatch.ForeignDealersBuySell.replace(/,/g, '')) / 1000) : 0,
                trust: tInstMatch ? Math.round(parseFloat(tInstMatch.InvestmentTrustBuySell.replace(/,/g, '')) / 1000) : 0,
                dealer: tInstMatch ? Math.round(parseFloat(tInstMatch.ProprietaryDealersBuySell.replace(/,/g, '')) / 1000) : 0
            };
        } else {
            // 搜尋上櫃
            const oPriceMatch = otcPrice.find(s => s.SecuritiesCompanyCode === searchQ || (s.CompanyName && s.CompanyName.toUpperCase().includes(searchQ)));
            if (oPriceMatch) {
                const code = oPriceMatch.SecuritiesCompanyCode;
                const oInfoMatch = otcInfo.find(s => s.SecuritiesCompanyCode === code);
                finalData = {
                    id: code, name: oPriceMatch.CompanyName, market: 'TPEx',
                    price: parseFloat(oPriceMatch.Close.replace(/,/g, '')),
                    pe: oInfoMatch ? parseFloat(oInfoMatch.PriceEarningsRatio) : NaN,
                    yield: oInfoMatch ? oInfoMatch.DividendYield : "-",
                    pb: oInfoMatch ? oInfoMatch.PriceBookRatio : "-",
                    // 上櫃目前 OpenAPI 較難穩定取得，暫時顯示無資料
                    foreign: 0, trust: 0, dealer: 0 
                };
            }
        }

        if (!finalData) return res.status(404).json({ error: '官方資料庫查無此標的' });

        // 計算 EPS 與狀態
        finalData.eps = (!isNaN(finalData.pe) && finalData.pe > 0) ? (finalData.price / finalData.pe).toFixed(2) : "N/A";
        finalData.isETF = finalData.id.startsWith('00') || (isNaN(finalData.pe) && finalData.eps === "N/A");
        finalData.hasPE = !isNaN(finalData.pe) && finalData.pe > 0;

        return res.status(200).json(finalData);

    } catch (error) {
        return res.status(500).json({ error: '伺服器錯誤' });
    }
}
