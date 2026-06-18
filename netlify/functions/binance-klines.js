const publicBaseUrls = Object.freeze([
  'https://api.binance.com',
  'https://data-api.binance.vision',
  'https://api1.binance.com',
  'https://api2.binance.com',
  'https://api3.binance.com'
]);

export async function handler(event) {
  const symbol = event.queryStringParameters?.symbol || 'BTCUSDT';
  const interval = event.queryStringParameters?.interval || '1m';
  const limit = Math.min(Number(event.queryStringParameters?.limit || 200), 1000);
  const allowedSymbols = ['BTCUSDT','ETHUSDT','BNBUSDT','SOLUSDT','XRPUSDT','ADAUSDT','AVAXUSDT','DOGEUSDT','LINKUSDT','DOTUSDT','LTCUSDT','TRXUSDT'];
  const allowedIntervals = ['1m','5m','15m','1h','4h','1d'];
  const headers = { 'content-type':'application/json', 'access-control-allow-origin':'*' };

  if (!allowedSymbols.includes(symbol)) return { statusCode: 400, headers, body: JSON.stringify({error:'symbol not allowed'}) };
  if (!allowedIntervals.includes(interval)) return { statusCode: 400, headers, body: JSON.stringify({error:'interval not allowed'}) };

  try {
    const baseUrls = [...new Set([process.env.BINANCE_SPOT_BASE_URL,...publicBaseUrls].filter(Boolean))];
    const failures = [];
    for (const baseUrl of baseUrls) {
      const url = `${baseUrl}/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
      try {
        const res = await fetch(url);
        const body = await res.text();
        if (res.ok) return { statusCode: 200, headers, body };
        failures.push(`${new URL(baseUrl).host}: HTTP ${res.status}`);
      } catch (error) {
        failures.push(`${new URL(baseUrl).host}: ${String(error?.message || error).slice(0,80)}`);
      }
    }
    return { statusCode: 502, headers, body: JSON.stringify({ error:'binance unavailable', detail:failures.join('; ') }) };
  } catch (error) {
    return { statusCode: 502, headers, body: JSON.stringify({ error:'binance request failed', detail:String(error?.message || error) }) };
  }
}
