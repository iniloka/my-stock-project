// 檔案路徑： netlify/functions/stockInfo.js

// 建立全域變數作為「快取 (Cache)」
// 在 Serverless 環境中，只要底層的容器沒有被銷毀，這個變數就會一直存在，藉此大幅減少對證交所的請求。
let cache = {
    data: null,
    timestamp: 0
};

// 設定快取有效時間為 1 小時 (毫秒)
const CACHE_DURATION = 1000 * 60 * 60; 

exports.handler = async function(event, context) {
    // 1. 取得網頁前端傳來的股票代號 (例如: ?id=2330)
    const stockId = event.queryStringParameters.id;

    if (!stockId) {
        return createResponse(400, { error: '請提供股票代號' });
    }

    const now = Date.now();

    // 2. 檢查快取機制：如果快取有資料，且還沒過期 (1小時內)，就直接用快取！
    if (cache.data && (now - cache.timestamp < CACHE_DURATION)) {
        console.log("✅ 使用伺服器快取資料，未向證交所發送請求");
        return processAndReturnStock(stockId, cache.data);
    }

    // 3. 快取過期或剛啟動：直接呼叫證交所的免費 OpenAPI
    console.log("🔄 快取為空或已過期，向證交所 OpenAPI 請求全市場資料...");
    try {
        // 這是證交所官方的 API：個股日本益比、殖利率及股價淨值比 (包含所有上市股票)
        const twseUrl = 'https://openapi.twse.com.tw/v1/exchangeReport/BWIBBU_ALL';
        
        // Node 18 以上環境內建 fetch，可以直接使用
        const response = await fetch(twseUrl);
        if (!response.ok) throw new Error('TWSE API 回應異常');

        const allStocks = await response.json();

        // 4. 更新快取資料與時間戳記
        cache.data = allStocks;
        cache.timestamp = now;

        // 5. 處理並回傳特定的股票
        return processAndReturnStock(stockId, cache.data);

    } catch (error) {
        return createResponse(500, { error: '獲取資料失敗，請稍後再試', details: error.message });
    }
};

// 輔助函式：從全市場資料中找出你要的那一檔，並整理格式
function processAndReturnStock(stockId, allStocks) {
    // 尋找符合代號的股票
    const stock = allStocks.find(s => s.Code === String(stockId));

    if (!stock) {
        return createResponse(404, { error: '找不到該股票代號，可能是上櫃股票或輸入錯誤' });
    }

    // 將證交所的資料轉換成我們網頁需要的格式
    const result = {
        id: stock.Code,
        name: stock.Name,
        pe: stock.PEratio,          // 本益比
        yield: stock.DividendYield, // 殖利率
        pb: stock.PBratio           // 股價淨值比
    };

    return createResponse(200, result);
}

// 輔助函式：建立回傳給瀏覽器的 HTTP 回應 (包含重要的 CORS 設定)
function createResponse(statusCode, bodyData) {
    return {
        statusCode: statusCode,
        headers: {
            // 解決 CORS 跨域限制，允許你的前端網頁讀取這個 API
            "Access-Control-Allow-Origin": "*",
            "Content-Type": "application/json"
        },
        body: JSON.stringify(bodyData)
    };
}