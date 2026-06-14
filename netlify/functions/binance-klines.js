export async function handler(event) {
  const symbol = event.queryStringParameters?.symbol || 'BTCUSDT';
  const interval = event.queryStringParameters?.interval || '1m';
  const limit = Math.min(Number(event.queryStringParameters?.limit || 200), 1000);
  const allowedSymbols = ['BTCUSDT','ETHUSDT','BNBUSDT','SOLUSDT','XRPUSDT'];
  const allowedIntervals = ['1m','5m','15m','1h','4h','1d'];
  const headers = { 'content-type':'application/json', 'access-control-allow-origin':'*' };

  if (!allowedSymbols.includes(symbol)) return { statusCode: 400, headers, body: JSON.stringify({error:'symbol not allowed'}) };
  if (!allowedIntervals.includes(interval)) return { statusCode: 400, headers, body: JSON.stringify({error:'interval not allowed'}) };

  try {
    const baseUrl = process.env.BINANCE_SPOT_BASE_URL || 'https://api.binance.com';
    const url = `${baseUrl}/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
    const res = await fetch(url);
    const body = await res.text();
    if (!res.ok) return { statusCode: res.status, headers, body: JSON.stringify({ error:'binance unavailable', status:res.status, detail:body.slice(0,300) }) };
    return { statusCode: 200, headers, body };
  } catch (error) {
    return { statusCode: 502, headers, body: JSON.stringify({ error:'binance request failed', detail:String(error?.message || error) }) };
  }
}
