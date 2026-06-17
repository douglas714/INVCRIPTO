const allowedSymbols = new Set(['BTCUSDT','ETHUSDT','BNBUSDT','SOLUSDT','XRPUSDT','ADAUSDT','AVAXUSDT','DOGEUSDT','LINKUSDT','DOTUSDT','LTCUSDT','TRXUSDT']);
const intervals = Object.freeze({ '1m': 260, '5m': 320, '15m': 320, '1h': 300, '4h': 260 });
const headers = {
  'content-type':'application/json',
  'access-control-allow-origin':'*',
  'cache-control':'public, max-age=5, stale-while-revalidate=10'
};

function json(statusCode, body){
  return { statusCode, headers, body: JSON.stringify(body) };
}

export async function handler(event){
  const symbol=String(event.queryStringParameters?.symbol || 'BTCUSDT').toUpperCase();
  if(!allowedSymbols.has(symbol)) return json(400,{ok:false,error:'symbol not allowed'});
  const baseUrl=process.env.BINANCE_SPOT_BASE_URL || 'https://api.binance.com';
  try{
    const entries=await Promise.all(Object.entries(intervals).map(async ([interval,limit])=>{
      const url=`${baseUrl}/api/v3/klines?symbol=${encodeURIComponent(symbol)}&interval=${interval}&limit=${limit}`;
      const response=await fetch(url,{headers:{accept:'application/json'}});
      const text=await response.text();
      if(!response.ok) throw new Error(`${interval}: HTTP ${response.status} ${text.slice(0,160)}`);
      let payload=[];
      try{payload=JSON.parse(text)}catch{throw new Error(`${interval}: resposta inválida`)}
      if(!Array.isArray(payload)) throw new Error(`${interval}: candles inválidos`);
      return [interval,payload];
    }));
    return json(200,{ok:true,symbol,asOf:new Date().toISOString(),klines:Object.fromEntries(entries)});
  }catch(error){
    return json(502,{ok:false,error:'Falha ao carregar confirmação multitemporal da Binance.',detail:String(error?.message || error)});
  }
}
