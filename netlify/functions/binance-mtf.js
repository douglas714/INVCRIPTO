const allowedSymbols = new Set(['BTCUSDT','ETHUSDT','BNBUSDT','SOLUSDT','XRPUSDT','ADAUSDT','AVAXUSDT','DOGEUSDT','LINKUSDT','DOTUSDT','LTCUSDT','TRXUSDT']);
const intervals = Object.freeze({ '1m': 260, '5m': 320, '15m': 320, '1h': 300, '4h': 260 });
const publicBaseUrls = Object.freeze([
  'https://api.binance.com',
  'https://data-api.binance.vision',
  'https://api1.binance.com',
  'https://api2.binance.com',
  'https://api3.binance.com'
]);
const headers = {
  'content-type':'application/json',
  'access-control-allow-origin':'*',
  'cache-control':'public, max-age=5, stale-while-revalidate=10'
};

function json(statusCode, body){
  return { statusCode, headers, body: JSON.stringify(body) };
}

async function fetchKlines(baseUrls, symbol, interval, limit){
  const failures=[];
  for(const baseUrl of baseUrls){
    const url=`${baseUrl}/api/v3/klines?symbol=${encodeURIComponent(symbol)}&interval=${interval}&limit=${limit}`;
    try{
      const response=await fetch(url,{headers:{accept:'application/json'}});
      const text=await response.text();
      if(!response.ok){
        failures.push(`${new URL(baseUrl).host}: HTTP ${response.status}`);
        continue;
      }
      const payload=JSON.parse(text);
      if(Array.isArray(payload)) return payload;
      failures.push(`${new URL(baseUrl).host}: invalid candles`);
    }catch(error){
      failures.push(`${new URL(baseUrl).host}: ${String(error?.message || error).slice(0,80)}`);
    }
  }
  throw new Error(`${interval}: ${failures.join('; ')}`);
}

export async function handler(event){
  const symbol=String(event.queryStringParameters?.symbol || 'BTCUSDT').toUpperCase();
  if(!allowedSymbols.has(symbol)) return json(400,{ok:false,error:'symbol not allowed'});
  const baseUrls=[...new Set([process.env.BINANCE_SPOT_BASE_URL,...publicBaseUrls].filter(Boolean))];
  try{
    const entries=await Promise.all(Object.entries(intervals).map(async ([interval,limit])=>[
      interval,
      await fetchKlines(baseUrls,symbol,interval,limit)
    ]));
    return json(200,{ok:true,symbol,asOf:new Date().toISOString(),klines:Object.fromEntries(entries)});
  }catch(error){
    return json(502,{ok:false,error:'Failed to load Binance multi-timeframe confirmation.',detail:String(error?.message || error)});
  }
}
