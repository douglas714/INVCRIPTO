import React, { useEffect, useState } from 'react';
import { supabase, hasSupabase } from './lib/supabase.js';
import { isValidCpf, maskCpf, onlyDigits, sha256 } from './lib/cpf.js';
import ClientPanel from './components/ClientPanel.jsx';
import AdminPanel from './components/AdminPanel.jsx';
import { Bot, Shield, UserRound } from 'lucide-react';

export default function App(){
  const [session,setSession]=useState(null);
  const [demoUser,setDemoUser]=useState(()=>JSON.parse(localStorage.getItem('inv_cripto_ia_demo_user')||'null'));
  const [tab,setTab]=useState('login');
  const user = session?.user || demoUser;

  useEffect(()=>{
    if(!hasSupabase) return;
    supabase.auth.getSession().then(({data})=>setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_event,session)=>setSession(session));
    return ()=>sub.subscription.unsubscribe();
  },[]);

  async function logout(){
    if(hasSupabase) await supabase.auth.signOut();
    localStorage.removeItem('inv_cripto_ia_demo_user'); setDemoUser(null);
  }

  return <div className="app-shell">
    <header className="topbar">
      <div className="brand"><div className="logo">DF</div><div><strong>INV CRIPTO IA</strong><span>Robô IA Spot BTC/ETH + Créditos INV</span></div></div>
      {user && <button className="btn ghost" onClick={logout}>Sair</button>}
    </header>
    {!user ? <AuthScreen setDemoUser={setDemoUser} tab={tab} setTab={setTab}/> : <MainRouter user={user}/>}
  </div>
}

function MainRouter({user}){
  const [view,setView]=useState('client');
  return <main className="main">
    <aside className="sidebar">
      <button className={view==='client'?'active':''} onClick={()=>setView('client')}><Bot size={18}/> Painel Cliente</button>
      <button className={view==='admin'?'active':''} onClick={()=>setView('admin')}><Shield size={18}/> Admin</button>
    </aside>
    <section className="content">{view==='client'?<ClientPanel user={user}/>:<AdminPanel/>}</section>
  </main>
}

function AuthScreen({setDemoUser,tab,setTab}){
  const [email,setEmail]=useState(''); const [password,setPassword]=useState(''); const [name,setName]=useState(''); const [cpf,setCpf]=useState(''); const [msg,setMsg]=useState('');
  async function demoLogin(){
    if(tab==='register' && !isValidCpf(cpf)){ setMsg('CPF inválido.'); return; }
    const cpfHash = tab==='register' ? await sha256(onlyDigits(cpf)) : 'demo-cpf-hash';
    const u={ id:'demo-user', email: email||'cliente@demo.com', full_name:name||'Cliente Demo', cpf_hash:cpfHash, role:'client' };
    localStorage.setItem('inv_cripto_ia_demo_user', JSON.stringify(u)); setDemoUser(u);
  }
  async function submit(e){
    e.preventDefault(); setMsg('');
    if(!hasSupabase){ await demoLogin(); return; }
    if(tab==='login'){
      const {error}=await supabase.auth.signInWithPassword({email,password}); if(error) setMsg(error.message);
    } else {
      if(!isValidCpf(cpf)){ setMsg('CPF inválido.'); return; }
      const cpfHash = await sha256(onlyDigits(cpf));
      const {data,error}=await supabase.auth.signUp({email,password});
      if(error){ setMsg(error.message); return; }
      const uid=data.user?.id;
      if(uid){
        await supabase.from('profiles').insert({id:uid,email,full_name:name,role:'client'});
        const doc=await supabase.from('user_documents').insert({user_id:uid,cpf_hash:cpfHash,cpf_masked:maskCpf(cpf)});
        if(doc.error){ setMsg('CPF já cadastrado ou erro no documento.'); return; }
        await supabase.rpc('credit_inv',{p_user_id:uid,p_amount:10,p_type:'initial_bonus',p_description:'Bônus inicial de cadastro'});
      }
      setMsg('Cadastro criado. Verifique seu e-mail se a confirmação estiver ativa.');
    }
  }
  return <div className="auth-card">
    <div className="auth-hero"><UserRound/><h1>{tab==='login'?'Entrar':'Criar conta'}</h1><p>{hasSupabase?'Supabase Auth ativo':'Modo demo local: configure Supabase para produção.'}</p></div>
    <div className="tabs"><button className={tab==='login'?'active':''} onClick={()=>setTab('login')}>Login</button><button className={tab==='register'?'active':''} onClick={()=>setTab('register')}>Cadastro</button></div>
    <form onSubmit={submit}>
      {tab==='register' && <><label>Nome</label><input value={name} onChange={e=>setName(e.target.value)} placeholder="Nome completo"/><label>CPF</label><input value={cpf} onChange={e=>setCpf(maskCpf(e.target.value))} placeholder="000.000.000-00"/></>}
      <label>E-mail</label><input value={email} onChange={e=>setEmail(e.target.value)} placeholder="email@dominio.com"/>
      <label>Senha</label><input type="password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="mínimo 6 caracteres"/>
      <button className="btn primary">{tab==='login'?'Entrar':'Cadastrar'}</button>
      {msg && <p className="msg">{msg}</p>}
    </form>
  </div>
}
