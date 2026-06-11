import React, { useEffect, useState } from 'react';
import { usd, num } from '../lib/format.js';
import { supabase, hasSupabase } from '../lib/supabase.js';

const demoClients = [
  { id: 'demo-user', full_name: 'Cliente Demo', email: 'cliente@demo.com', phone: '(22) 99999-9999', cpf_masked: '***.***.***-00', inv: 8.7, status: 'active', lucro: 46.2, taxa: 4.62, mode: 'Paper' },
  { id: 'demo-user-2', full_name: 'Maria Teste', email: 'maria@demo.com', phone: '(21) 99999-9999', cpf_masked: '***.***.***-11', inv: 10, status: 'blocked', lucro: 0, taxa: 0, mode: 'Paper' }
];

export default function AdminPanel() {
  const [clients, setClients] = useState(demoClients);
  const [selected, setSelected] = useState(null);
  const [amount, setAmount] = useState('10');
  const [msg, setMsg] = useState('');

  async function loadClients() {
    if (!hasSupabase) {
      setClients(demoClients);
      return;
    }

    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData?.session?.access_token;
    if (token) {
      const response = await fetch('/.netlify/functions/admin-clients', { headers: { authorization: `Bearer ${token}` } }).catch(() => null);
      if (response?.ok) {
        const payload = await response.json();
        setClients((payload.clients || []).map(client => ({
          id: client.user_id,
          full_name: client.full_name,
          email: client.email,
          phone: client.phone,
          cpf_masked: client.cpf_masked,
          inv: Number(client.balance_inv || 0),
          demoUsdt: Number(client.demo_usdt || 0),
          realUsdt: Number(client.real_usdt_free || 0),
          binanceKey: client.binance_key,
          binanceCanTrade: client.binance_can_trade,
          status: client.status,
          lucro: Number(client.demo_profit_usdt || 0),
          taxa: Number(client.fee_today_inv || 0),
          mode: client.bot_mode || 'paper',
          botStatus: client.bot_status || 'inactive'
        })));
        return;
      }
    }

    const { data, error } = await supabase
      .from('admin_clients_view')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      setMsg('Não foi possível carregar clientes. Verifique se seu usuário está como admin.');
      return;
    }

    setClients((data || []).map(client => ({
      id: client.user_id,
      full_name: client.full_name,
      email: client.email,
      phone: client.phone,
      cpf_masked: client.cpf_masked,
      inv: Number(client.balance_inv || 0),
      demoUsdt: Number(client.demo_usdt || 0),
      realUsdt: Number(client.real_usdt_free || 0),
      binanceKey: client.binance_key,
      binanceCanTrade: client.binance_can_trade,
      status: client.status,
      lucro: Number(client.profit_today_brl || 0),
      taxa: Number(client.fee_today_inv || 0),
      mode: client.bot_mode || 'paper'
    })));
  }

  useEffect(() => { loadClients(); }, []);

  async function blockUser(userId, blocked) {
    setMsg('');
    if (!hasSupabase) {
      setClients(current => current.map(client => client.id === userId ? { ...client, status: blocked ? 'blocked' : 'active' } : client));
      setMsg(blocked ? 'Usuário bloqueado com sucesso.' : 'Usuário desbloqueado com sucesso.');
      return;
    }

    const { error } = await supabase.rpc('admin_set_user_blocked', { p_user_id: userId, p_blocked: blocked });
    if (error) {
      setMsg(error.message);
      return;
    }

    await loadClients();
    setMsg(blocked ? 'Usuário bloqueado com sucesso.' : 'Usuário desbloqueado com sucesso.');
  }

  async function addInv(userId) {
    const value = Number(String(amount).replace(',', '.'));
    if (!value || value <= 0) {
      setMsg('Informe um valor ENV válido.');
      return;
    }

    setMsg('');
    if (!hasSupabase) {
      setClients(current => current.map(client => client.id === userId ? { ...client, inv: client.inv + value } : client));
      setMsg(`Adicionado ${num(value, 2)} ENV.`);
      return;
    }

    const { error } = await supabase.rpc('admin_credit_inv', { p_user_id: userId, p_amount: value, p_description: 'Crédito manual pelo painel admin' });
    if (error) {
      setMsg(error.message);
      return;
    }

    await loadClients();
    setMsg(`Adicionado ${num(value, 2)} ENV.`);
  }

  const totalInv = clients.reduce((sum, client) => sum + (Number(client.inv) || 0), 0);
  const totalDemo = clients.reduce((sum, client) => sum + (Number(client.demoUsdt) || 0), 0);
  const totalReal = clients.reduce((sum, client) => sum + (Number(client.realUsdt) || 0), 0);
  const totalLucro = clients.reduce((sum, client) => sum + (Number(client.lucro) || 0), 0);
  const totalTaxa = clients.reduce((sum, client) => sum + (Number(client.taxa) || 0), 0);

  return <div>
    <div className="page-title"><h1>Painel Administrador</h1><p>Clientes, saldos ENV, pagamentos, bloqueios e auditoria.</p></div>
    {msg && <div className="alert">{msg}</div>}
    <div className="grid">
      <div className="card"><span>Clientes</span><strong>{clients.length}</strong><small>Cadastrados</small></div>
      <div className="card"><span>ENV em aberto</span><strong>{num(totalInv, 2)}</strong><small>Saldo total</small></div>
      <div className="card"><span>USDT demo</span><strong>{usd(totalDemo)}</strong><small>Saldo simulado</small></div>
      <div className="card"><span>USDT real</span><strong>{usd(totalReal)}</strong><small>Binance conectada</small></div>
      <div className="card"><span>Lucro em USDT</span><strong>{usd(totalLucro)}</strong><small>Hoje</small></div>
      <div className="card"><span>Taxa ENV gerada</span><strong>{usd(totalTaxa)}</strong><small>Hoje</small></div>
    </div>
    <div className="panel"><h3>Clientes</h3><div className="table-wrap"><table><thead><tr><th>Nome</th><th>E-mail</th><th>Telefone</th><th>CPF</th><th>ENV</th><th>Demo USDT</th><th>Real USDT</th><th>Binance</th><th>Status</th><th>Taxa</th><th></th></tr></thead><tbody>{clients.map((client, index) => <tr key={client.id || index}><td>{client.full_name || client.name}</td><td>{client.email}</td><td>{client.phone || '-'}</td><td>{client.cpf_masked || client.cpf}</td><td>{num(client.inv, 2)}</td><td>{usd(client.demoUsdt || 0)}</td><td>{usd(client.realUsdt || 0)}</td><td>{client.binanceKey ? `${client.binanceKey} ${client.binanceCanTrade?'trade':'read'}` : '-'}</td><td><span className={client.status === 'blocked' ? 'badge danger' : 'badge ok'}>{client.status === 'blocked' ? 'Bloqueado' : client.status || 'Ativo'}</span></td><td>{usd(client.taxa)}</td><td><button className="btn small" onClick={() => setSelected(client)}>Gerenciar</button></td></tr>)}</tbody></table></div></div>
    {selected && <div className="panel"><h3>Gerenciar {selected.full_name || selected.name}</h3><div className="controls"><input style={{ maxWidth: 140 }} value={amount} onChange={event => setAmount(event.target.value)} placeholder="ENV"/><button className="btn primary" onClick={() => addInv(selected.id)}>Adicionar ENV manual</button>{selected.status === 'blocked' ? <button className="btn ghost" onClick={() => blockUser(selected.id, false)}>Desbloquear usuário</button> : <button className="btn danger" onClick={() => blockUser(selected.id, true)}>Bloquear usuário</button>}</div><p className="muted">Ao bloquear, o usuário fica com status bloqueado e todos os robôs dele são pausados. Cada ação entra em admin_actions.</p></div>}
  </div>;
}
