let cache = { data: null, timestamp: 0 };
const CACHE_DURATION = 1000 * 60 * 15; // 快取 15 分鐘，減輕抓取負擔

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET');

    const query = req.query.id;
    if (!query) return res.status(400).json({ error: '請提供股票代號或名稱' });

    const searchQ = query.trim().toUpperCase();
    const now = Date.now();

    try {
        // 🚀 引擎 A：抓取官方穩定資料 (保證不當機，包含所有 ETF)
        if (!cache.data || (now - cache.timestamp > CACHE_DURATION)) {
            const [twseInfo, twsePrice, otcInfo, otcPrice] = await Promise.all([
                fetch('https://openapi.twse.com.tw/v1/exchangeReport/BWIBBU_ALL').then(r => r.json()),
                fetch('https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL').then(r => r.json()),
                fetch('https://www.tpex.org.tw/openapi/v1/tpex_mainboard_peratio_analysis').then(r => r.json()),
                fetch('https://www.tpex.org.tw/openapi/v1/tpex_mainboard_quotes').then(r => r.json())
            ]);
            cache.data = { twseInfo, twsePrice, otcInfo, otcPrice };
            cache.timestamp = now;
        }

        const { twseInfo, twsePrice, otcInfo, otcPrice } = cache.data;
        let finalData = null;
        let yahooSymbol = '';

        // 搜尋上市 (支援名稱與代號)
        const tPriceMatch = twsePrice.find(s => s.Code === searchQ || s.Name.toUpperCase().includes(searchQ));
        if (tPriceMatch) {
            const code = tPriceMatch.Code;
            const tInfoMatch = twseInfo.find(s => s.Code === code);
            yahooSymbol = code + '.TW';
            finalData = {
                id: code, name: tPriceMatch.Name,
                price: parseFloat(tPriceMatch.ClosingPrice.replace(/,/g, '')),
                pe: tInfoMatch ? parseFloat(tInfoMatch.PEratio) : NaN,
                yield: tInfoMatch ? tInfoMatch.DividendYield : "-",
                pb: tInfoMatch ? tInfoMatch.PBratio : "-"
            };
        } else {
            // 搜尋上櫃
            const oPriceMatch = otcPrice.find(s => s.SecuritiesCompanyCode === searchQ || s.CompanyName.toUpperCase().includes(searchQ));
            if (oPriceMatch) {
                const code = oPriceMatch.SecuritiesCompanyCode;
                const oInfoMatch = otcInfo.find(s => s.SecuritiesCompanyCode === code);
                yahooSymbol = code + '.TWO';
                finalData = {
                    id: code, name: oPriceMatch.CompanyName,
                    price: parseFloat(oPriceMatch.Close.replace(/,/g, '')),
                    pe: oInfoMatch ? parseFloat(oInfoMatch.PriceEarningsRatio) : NaN,
                    yield: oInfoMatch ? oInfoMatch.DividendYield : "-",
                    pb: oInfoMatch ? oInfoMatch.PriceBookRatio : "-"
                };
            }
        }

        if (!finalData) return res.status(404).json({ error: '官方資料庫查無此標的，請確認代號或名稱' });

        // 先用官方資料反推 EPS (虧損股會變 N/A)
        finalData.eps = (!isNaN(finalData.pe) && finalData.pe > 0) ? (finalData.price / finalData.pe).toFixed(2) : "N/A";

        // 🚀 引擎 B：挑戰 Yahoo Finance 拿真實 EPS (安靜模式，失敗不報錯)
        try {
            // 偽裝正常瀏覽器拿 Cookie
            const cookieRes = await fetch('https://fc.yahoo.com', { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' } });
            const cookies = cookieRes.headers.get('set-cookie') || '';
            const crumbRes = await fetch('https://query1.finance.yahoo.com/v1/test/getcrumb', { headers: { cookie: cookies, 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' } });
            const crumb = await crumbRes.text();
            
            if (crumb) {
                const yfRes = await fetch(`https://query1.finance.yahoo.com/v7/finance/quote?symbols=${yahooSymbol}&crumb=${crumb}`, { headers: { cookie: cookies, 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' } });
                const yfData = await yfRes.json();
                if (yfData.quoteResponse && yfData.quoteResponse.result.length > 0) {
                    const yData = yfData.quoteResponse.result[0];
                    if (yData.epsTrailingTwelveMonths !== undefined) {
                        finalData.eps = yData.epsTrailingTwelveMonths.toFixed(2); // 成功拿到真實 EPS！
                    }
                    if (yData.trailingPE !== undefined) {
                        finalData.pe = yData.trailingPE;
                    }
                }
            }
        } catch (e) {
            // 被 Yahoo 擋下就安靜失敗，繼續用官方資料，保證網頁不會壞掉
            console.log('Yahoo API blocked, falling back to TWSE data.');
        }

        // 整理給前端的防呆狀態
        const pe = finalData.pe;
        finalData.isETF = finalData.id.startsWith('00') || (isNaN(pe) && finalData.eps === "N/A");
        finalData.hasPE = !isNaN(pe) && pe > 0;
        
        finalData.suggestedBuy = (finalData.price * 0.95).toFixed(2);
        finalData.suggestedStop = (finalData.price * 0.88).toFixed(2);
        finalData.foreign = "-"; finalData.trust = "-"; finalData.dealer = "-";

        return res.status(200).json(finalData);

    } catch (error) {
        return res.status(500).json({ error: '伺服器錯誤' });
    }
}
