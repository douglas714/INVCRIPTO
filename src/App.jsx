import React, { useEffect, useState } from 'react';
import { supabase, hasSupabase } from './lib/supabase.js';
import { isValidCpf, maskCpf, onlyDigits, sha256 } from './lib/cpf.js';
import ClientPanel from './components/ClientPanel.jsx';
import AdminPanel from './components/AdminPanel.jsx';
import { Bot, Shield, UserRound } from 'lucide-react';

export default function App(){
  const [session,setSession]=useState(null);
  const [demoUser,setDemoUser]=useState(()=>JSON.parse(localStorage.getItem('inv_cripto_ia_demo_user')||'null'));
  const [profile,setProfile]=useState(null);
  const [tab,setTab]=useState('login');
  const user = profile || session?.user || demoUser;

  useEffect(()=>{
    if(!hasSupabase) return;
    supabase.auth.getSession().then(({data})=>setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_event,session)=>setSession(session));
    return ()=>sub.subscription.unsubscribe();
  },[]);

  useEffect(()=>{
    let cancelled=false;
    async function loadProfile(){
      if(!hasSupabase || !session?.user?.id){ setProfile(demoUser || null); return; }
      const { data } = await supabase
        .from('profiles')
        .select('id,email,full_name,role,status')
        .eq('id', session.user.id)
        .maybeSingle();
      if(cancelled) return;
      setProfile({
        ...session.user,
        ...(data || {}),
        id: session.user.id,
        email: data?.email || session.user.email,
        role: data?.role || 'client',
        status: data?.status || 'active'
      });
    }
    loadProfile();
    return()=>{cancelled=true};
  },[session?.user?.id,demoUser]);

  async function logout(){
    if(hasSupabase) await supabase.auth.signOut();
    localStorage.removeItem('inv_cripto_ia_demo_user');
    setDemoUser(null);
    setProfile(null);
  }

  return <div className="app-shell">
    <header className="topbar">
      <div className="brand"><div className="logo">DF</div><div><strong>INV CRIPTO IA</strong><span>Robo IA Spot BTC/ETH + Creditos INV</span></div></div>
      {user && <button className="btn ghost" onClick={logout}>Sair</button>}
    </header>
    {!user ? <AuthScreen setDemoUser={setDemoUser} tab={tab} setTab={setTab}/> : <MainRouter user={user}/>}
  </div>;
}

function MainRouter({user}){
  const [view,setView]=useState('client');
  const isAdmin = user?.role === 'admin';
  useEffect(()=>{ if(!isAdmin && view === 'admin') setView('client'); },[isAdmin,view]);
  return <main className="main">
    <aside className="sidebar">
      <button className={view==='client'?'active':''} onClick={()=>setView('client')}><Bot size={18}/> Painel Cliente</button>
      {isAdmin && <button className={view==='admin'?'active':''} onClick={()=>setView('admin')}><Shield size={18}/> Admin</button>}
    </aside>
    <section className="content">{view==='admin' && isAdmin ? <AdminPanel/> : <ClientPanel user={user}/>}</section>
  </main>;
}

function AuthScreen({setDemoUser,tab,setTab}){
  const [email,setEmail]=useState('');
  const [password,setPassword]=useState('');
  const [name,setName]=useState('');
  const [cpf,setCpf]=useState('');
  const [msg,setMsg]=useState('');

  async function demoLogin(){
    if(tab==='register' && !isValidCpf(cpf)){ setMsg('CPF invalido.'); return; }
    const cpfHash = tab==='register' ? await sha256(onlyDigits(cpf)) : 'demo-cpf-hash';
    const u={ id:'demo-user', email: email||'cliente@demo.com', full_name:name||'Cliente Demo', cpf_hash:cpfHash, role:'client', status:'active' };
    localStorage.setItem('inv_cripto_ia_demo_user', JSON.stringify(u));
    setDemoUser(u);
  }

  async function submit(e){
    e.preventDefault();
    setMsg('');
    if(!hasSupabase){ await demoLogin(); return; }
    if(tab==='login'){
      const {error}=await supabase.auth.signInWithPassword({email,password});
      if(error) setMsg(error.message);
      return;
    }

    if(!isValidCpf(cpf)){ setMsg('CPF invalido.'); return; }
    const cpfHash = await sha256(onlyDigits(cpf));
    const { data: docExists } = await supabase.from('user_documents').select('id').eq('cpf_hash',cpfHash).maybeSingle();
    if(docExists){ setMsg('CPF ja cadastrado. Use login ou redefina a senha.'); return; }
    const { data: profileExists } = await supabase.from('profiles').select('id').eq('email',email).maybeSingle();
    if(profileExists){ setMsg('E-mail ja cadastrado. Use login ou redefina a senha.'); return; }

    const {data,error}=await supabase.auth.signUp({email,password,options:{data:{full_name:name,role:'client'}}});
    if(error){ setMsg(error.message); return; }
    const uid=data.user?.id;
    if(uid){
      const profileWrite = await supabase.from('profiles').upsert({id:uid,email,full_name:name,role:'client',status:'active'},{onConflict:'id'});
      if(profileWrite.error){ setMsg(`Cadastro criado no Auth, mas falhou perfil: ${profileWrite.error.message}`); return; }
      const doc=await supabase.from('user_documents').upsert({user_id:uid,cpf_hash:cpfHash,cpf_masked:maskCpf(cpf)},{onConflict:'user_id'});
      if(doc.error){ setMsg(`Cadastro criado, mas falhou CPF: ${doc.error.message}`); return; }
      await supabase.rpc('credit_inv',{p_user_id:uid,p_amount:10,p_type:'initial_bonus',p_description:'Bonus inicial de cadastro'}).catch(()=>null);
    }
    setMsg('Cadastro criado. Verifique seu e-mail se a confirmacao estiver ativa.');
  }

  return <div className="auth-card">
    <div className="auth-hero"><UserRound/><h1>{tab==='login'?'Entrar':'Criar conta'}</h1><p>{hasSupabase?'Supabase Auth ativo':'Modo demo local: configure Supabase para producao.'}</p></div>
    <div className="tabs"><button className={tab==='login'?'active':''} onClick={()=>setTab('login')}>Login</button><button className={tab==='register'?'active':''} onClick={()=>setTab('register')}>Cadastro</button></div>
    <form onSubmit={submit}>
      {tab==='register' && <><label>Nome</label><input value={name} onChange={e=>setName(e.target.value)} placeholder="Nome completo"/><label>CPF</label><input value={cpf} onChange={e=>setCpf(maskCpf(e.target.value))} placeholder="000.000.000-00"/></>}
      <label>E-mail</label><input value={email} onChange={e=>setEmail(e.target.value)} placeholder="email@dominio.com"/>
      <label>Senha</label><input type="password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="minimo 6 caracteres"/>
      <button className="btn primary">{tab==='login'?'Entrar':'Cadastrar'}</button>
      {msg && <p className="msg">{msg}</p>}
    </form>
  </div>;
}
