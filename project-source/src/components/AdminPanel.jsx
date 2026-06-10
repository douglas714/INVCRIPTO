import React, { useEffect, useState } from 'react';
import { brl, usd, num } from '../lib/format.js';
import { supabase, hasSupabase } from '../lib/supabase.js';

const demoClients=[
  {id:'demo-user', full_name:'Cliente Demo', email:'cliente@demo.com', phone:'(22) 99999-9999', cpf_masked:'***.***.***-00', inv:8.7, status:'active', lucro:46.2, taxa:4.62, mode:'Paper'},
  {id:'demo-user-2', full_name:'Maria Teste', email:'maria@demo.com', phone:'(21) 99999-9999', cpf_masked:'***.***.***-11', inv:10, status:'blocked', lucro:0, taxa:0, mode:'Paper'}
];

export default function AdminPanel(){
  const [clients,setClients]=useState(demoClients);
  const [selected,setSelected]=useState(null);
  const [amount,setAmount]=useState('10');
  const [msg,setMsg]=useState('');

  async function loadClients(){
    if(!hasSupabase){ setClients(demoClients); return; }
    const { data, error } = await supabase
      .from('admin_clients_view')
      .select('*')
      .order('created_at', { ascending:false });
    if(error){ setMsg('Não foi possível carregar clientes. Verifique se seu usuário está como admin.'); return; }
    setClients((data||[]).map(c=>({
      id:c.user_id,
      full_name:c.full_name,
      email:c.email,
      phone:c.phone,
      cpf_masked:c.cpf_masked,
      inv:Number(c.balance_inv||0),
      status:c.status,
      lucro:Number(c.profit_today_brl||0),
      taxa:Number(c.fee_today_inv||0),
      mode:c.bot_mode || 'paper'
    })));
  }

  useEffect(()=>{ loadClients(); },[]);

  async function blockUser(userId, blocked){
    setMsg('');
    if(!hasSupabase){
      setClients(c=>c.map(x=>x.id===userId?{...x,status:blocked?'blocked':'active'}:x));
      return;
    }
    const { error } = await supabase.rpc('admin_set_user_blocked', { p_user_id:userId, p_blocked:blocked });
    if(error){ setMsg(error.message); return; }
    await loadClients();
    setMsg(blocked ? 'Usuário bloqueado com sucesso.' : 'Usuário desbloqueado com sucesso.');
  }

  async function addInv(userId){
    const value = Number(String(amount).replace(',','.'));
    if(!value || value <= 0){ setMsg('Informe um valor INV válido.'); return; }
    setMsg('');
    if(!hasSupabase){
      setClients(c=>c.map(x=>x.id===userId?{...x,inv:x.inv+value}:x));
      return;
    }
    const { error } = await supabase.rpc('admin_credit_inv', { p_user_id:userId, p_amount:value, p_description:'Crédito manual pelo painel admin' });
    if(error){ setMsg(error.message); return; }
    await loadClients();
    setMsg(`Adicionado ${num(value,2)} ENV.`);
  }

  const totalInv = clients.reduce((a,c)=>a+(Number(c.inv)||0),0);
  const totalLucro = clients.reduce((a,c)=>a+(Number(c.lucro)||0),0);
  const totalTaxa = clients.reduce((a,c)=>a+(Number(c.taxa)||0),0);

  return <div>
    <div className="page-title"><h1>Painel Administrador</h1><p>Clientes, saldos ENV, pagamentos, bloqueios e auditoria.</p></div>
    {msg && <div className="alert">{msg}</div>}
    <div className="grid">
      <div className="card"><span>Clientes</span><strong>{clients.length}</strong><small>Cadastrados</small></div>
      <div className="card"><span>ENV em aberto</span><strong>{num(totalInv,2)}</strong><small>Saldo total</small></div>
      <div className="card"><span>Lucro em USDT</span><strong>{usd(totalLucro)}</strong><small>Hoje</small></div>
      <div className="card"><span>Taxa ENV gerada</span><strong>{usd(totalTaxa)}</strong><small>Hoje</small></div>
    </div>
    <div className="panel"><h3>Clientes</h3><div className="table-wrap"><table><thead><tr><th>Nome</th><th>E-mail</th><th>Telefone</th><th>CPF</th><th>ENV</th><th>Status</th><th>Lucro hoje</th><th>Taxa</th><th></th></tr></thead><tbody>{clients.map((c,i)=><tr key={c.id||i}><td>{c.full_name||c.name}</td><td>{c.email}</td><td>{c.phone||'-'}</td><td>{c.cpf_masked||c.cpf}</td><td>{num(c.inv,2)}</td><td><span className={c.status==='blocked'?'badge danger':'badge ok'}>{c.status==='blocked'?'Bloqueado':'Ativo'}</span></td><td>{usd(c.lucro)}</td><td>{usd(c.taxa)}</td><td><button className="btn small" onClick={()=>setSelected(c)}>Gerenciar</button></td></tr>)}</tbody></table></div></div>
    {selected&&<div className="panel"><h3>Gerenciar {selected.full_name||selected.name}</h3><div className="controls"><input style={{maxWidth:140}} value={amount} onChange={e=>setAmount(e.target.value)} placeholder="INV"/><button className="btn primary" onClick={()=>addInv(selected.id)}>Adicionar ENV manual</button>{selected.status==='blocked'?<button className="btn ghost" onClick={()=>blockUser(selected.id,false)}>Desbloquear usuário</button>:<button className="btn danger" onClick={()=>blockUser(selected.id,true)}>Bloquear usuário</button>}</div><p className="muted">Ao bloquear, o usuário fica com status bloqueado e todos os robôs dele são pausados. Cada ação entra em admin_actions.</p></div>}
  </div>
}
