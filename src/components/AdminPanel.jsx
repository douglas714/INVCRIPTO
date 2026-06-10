import React, { useState } from 'react';
import { brl, num } from '../lib/format.js';

const demoClients=[
  {name:'Cliente Demo', email:'cliente@demo.com', cpf:'***.***.***-00', inv:8.7, status:'Ativo', lucro:46.2, taxa:4.62, mode:'Paper'},
  {name:'Maria Teste', email:'maria@demo.com', cpf:'***.***.***-11', inv:10, status:'Pausado', lucro:0, taxa:0, mode:'Paper'}
];
export default function AdminPanel(){
  const [clients,setClients]=useState(demoClients);
  const [selected,setSelected]=useState(null);
  return <div>
    <div className="page-title"><h1>Painel Administrador</h1><p>Clientes, saldos INV, pagamentos e auditoria.</p></div>
    <div className="grid">
      <div className="card"><span>Clientes</span><strong>{clients.length}</strong><small>Cadastrados</small></div>
      <div className="card"><span>INV em aberto</span><strong>{num(clients.reduce((a,c)=>a+c.inv,0),2)}</strong><small>Saldo total</small></div>
      <div className="card"><span>Lucro simulado</span><strong>{brl(clients.reduce((a,c)=>a+c.lucro,0))}</strong><small>Hoje</small></div>
      <div className="card"><span>Taxa gerada</span><strong>{brl(clients.reduce((a,c)=>a+c.taxa,0))}</strong><small>Hoje</small></div>
    </div>
    <div className="panel"><h3>Clientes</h3><div className="table-wrap"><table><thead><tr><th>Nome</th><th>E-mail</th><th>CPF</th><th>INV</th><th>Status</th><th>Lucro hoje</th><th>Taxa</th><th></th></tr></thead><tbody>{clients.map((c,i)=><tr key={i}><td>{c.name}</td><td>{c.email}</td><td>{c.cpf}</td><td>{num(c.inv,2)}</td><td>{c.status}</td><td>{brl(c.lucro)}</td><td>{brl(c.taxa)}</td><td><button className="btn small" onClick={()=>setSelected(c)}>Gerenciar</button></td></tr>)}</tbody></table></div></div>
    {selected&&<div className="panel"><h3>Gerenciar {selected.name}</h3><div className="controls"><button className="btn primary">Adicionar INV manual</button><button className="btn ghost">Bloquear robô</button><button className="btn danger">Bloquear cliente</button></div><p className="muted">No Supabase real, cada ação será registrada em admin_actions.</p></div>}
  </div>
}
