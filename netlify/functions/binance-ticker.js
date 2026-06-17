const headers = { 'content-type': 'application/json', 'access-control-allow-origin': '*' };
const allowedSymbols = ['BTCUSDT','ETHUSDT','BNBUSDT','SOLUSDT','XRPUSDT','ADAUSDT','AVAXUSDT','DOGEUSDT','LINKUSDT','DOTUSDT','LTCUSDT','TRXUSDT'];

export async function handler(event) {
  const symbol = event.queryStringParameters?.symbol || 'BTCUSDT';
  if (!allowedSymbols.includes(symbol)) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'symbol not allowed' }) };
  }

  const bases = [
    process.env.BINANCE_SPOT_BASE_URL || 'https://api.binance.com',
    'https://api1.binance.com',
    'https://api2.binance.com',
    'https://api3.binance.com'
  ];

  let lastError = null;
  for (const base of bases) {
    try {
      const response = await fetch(`${base}/api/v3/ticker/24hr?symbol=${symbol}`);
      const text = await response.text();
      if (!response.ok) {
        lastError = { status: response.status, detail: text.slice(0, 240) };
        continue;
      }
      return { statusCode: 200, headers, body: text };
    } catch (error) {
      lastError = { detail: String(error?.message || error) };
    }
  }

  return { statusCode: 502, headers, body: JSON.stringify({ error: 'binance ticker unavailable', ...lastError }) };
}
