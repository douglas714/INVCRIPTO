export async function handler(event) {
  const rawSymbol = event.queryStringParameters?.symbol || 'BTCUSDT';
  const symbol = String(rawSymbol).toUpperCase().replace(/[^A-Z0-9]/g, '');
  const interval = event.queryStringParameters?.interval || '1m';
  const limit = Math.min(Number(event.queryStringParameters?.limit || 500), 1000);
  const allowed = ['BTCUSDT','ETHUSDT','BNBUSDT','SOLUSDT','XRPUSDT','ADAUSDT','AVAXUSDT','DOGEUSDT','LINKUSDT','DOTUSDT','LTCUSDT','TRXUSDT'];
  if (!allowed.includes(symbol)) {
    return { statusCode: 400, headers: { 'content-type':'application/json' }, body: JSON.stringify({error:'symbol not allowed'}) };
  }
  const allowedIntervals = ['1m','3m','5m','15m','30m','1h','2h','4h','6h','8h','12h','1d','3d','1w','1M'];
  if (!allowedIntervals.includes(interval)) {
    return { statusCode: 400, headers: { 'content-type':'application/json' }, body: JSON.stringify({error:'interval not allowed'}) };
  }
  const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
  const res = await fetch(url, { headers: { 'cache-control': 'no-cache' }});
  const body = await res.text();
  return {
    statusCode: res.status,
    headers: {
      'content-type':'application/json',
      'access-control-allow-origin':'*',
      'cache-control':'no-store, max-age=0'
    },
    body
  };
}
