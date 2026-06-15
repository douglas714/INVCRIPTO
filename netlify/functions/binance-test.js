export async function handler(event) {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };
  // MVP placeholder. In production, sign Binance requests server-side and never expose secret.
  return { statusCode: 200, headers:{'content-type':'application/json'}, body: JSON.stringify({ ok:true, mode:'placeholder', message:'Estrutura pronta para teste de API Binance no backend.' }) };
}
