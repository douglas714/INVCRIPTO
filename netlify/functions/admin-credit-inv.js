export async function handler(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    return { statusCode: 500, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ error: 'Supabase service role not configured' }) };
  }

  let payload = {};
  try {
    payload = JSON.parse(event.body || '{}');
  } catch (_) {
    return { statusCode: 400, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ error: 'Invalid JSON body' }) };
  }

  const rpcBody = {
    p_user_id: payload.user_id,
    p_amount: payload.amount_inv,
    p_type: 'admin_adjustment',
    p_description: payload.description || 'Crédito manual admin'
  };

  const response = await fetch(`${supabaseUrl.replace(/\/$/, '')}/rest/v1/rpc/credit_inv`, {
    method: 'POST',
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(rpcBody)
  });

  const text = await response.text();

  if (!response.ok) {
    return { statusCode: response.status, headers: { 'content-type': 'application/json' }, body: text || JSON.stringify({ error: 'Supabase RPC error' }) };
  }

  return { statusCode: 200, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ok: true }) };
}
