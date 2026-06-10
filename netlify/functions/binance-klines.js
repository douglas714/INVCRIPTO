export async function handler(event) {
  const symbol = event.queryStringParameters?.symbol || 'BTCUSDT';
  const interval = event.queryStringParameters?.interval || '1m';
  const limit = event.queryStringParameters?.limit || '200';
  const allowed = ['BTCUSDT','ETHUSDT','BNBUSDT','SOLUSDT','XRPUSDT','ADAUSDT','AVAXUSDT','DOGEUSDT','LINKUSDT','DOTUSDT','LTCUSDT','TRXUSDT'];
  if (!allowed.includes(symbol)) return { statusCode: 400, body: JSON.stringify({error:'symbol not allowed'}) };
  const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
  const res = await fetch(url);
  const body = await res.text();
  return { statusCode: res.status, headers: { 'content-type':'application/json', 'access-control-allow-origin':'*' }, body };
}
