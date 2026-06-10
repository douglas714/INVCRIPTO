import React, { useEffect, useState } from 'react';
import { supabase, hasSupabase } from './lib/supabase.js';
import { isValidCpf, maskCpf, onlyDigits, sha256 } from './lib/cpf.js';
import ClientPanel from './components/ClientPanel.jsx';
import AdminPanel from './components/AdminPanel.jsx';
import { Bot, Shield, UserRound, LogOut } from 'lucide-react';

class ErrorBoundary extends React.Component {
  constructor(props){ super(props); this.state={hasError:false,error:null}; }
  static getDerivedStateFromError(error){ return {hasError:true,error}; }
  componentDidCatch(error, info){ console.error('INVCRIPTO UI error:', error, info); }
  render(){
    if(this.state.hasError){
      return <div className="app-shell premium-theme"><div className="fallback-screen"><img src="/favicon.png" alt="INVCRIPTO"/><h1>INVCRIPTO IA</h1><p>O painel encontrou um erro de carregamento visual. Atualize a página ou verifique as variáveis do Netlify.</p><button className="btn primary" onClick={()=>location.reload()}>Recarregar painel</button><small>{String(this.state.error?.message||'Erro desconhecido')}</small></div></div>
    }
    return this.props.children;
  }
}

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
    localStorage.removeItem('inv_cripto_ia_demo_user');
    setDemoUser(null);
  }

  return <ErrorBoundary><div className="app-shell premium-theme">
    <header className="topbar premium-topbar">
      <div className="brand premium-brand">
        <img src="/favicon.png" className="brand-mark" alt="INVCRIPTO"/>
        <div>
          <strong>INVCRIPTO IA</strong>
          <span>Crypto Trading Robot · Paper Trade · Binance Spot</span>
        </div>
      </div>
      {user && <button className="btn ghost" onClick={logout}><LogOut size={16}/> Sair</button>}
    </header>
    {!user ? <AuthScreen setDemoUser={setDemoUser} tab={tab} setTab={setTab}/> : <MainRouter user={user}/>}  
  </div></ErrorBoundary>
}

function MainRouter({user}){
  const [view,setView]=useState('client');
  return <main className="main premium-main">
    <aside className="sidebar premium-sidebar">
      <div className="sidebar-logo-card">
        <img src="/invcripto-logo.png" alt="INVCRIPTO IA"/>
      </div>
      <button className={view==='client'?'active':''} onClick={()=>setView('client')}><Bot size={18}/> Painel Cliente</button>
      <button className={view==='admin'?'active':''} onClick={()=>setView('admin')}><Shield size={18}/> Admin</button>
      <div className="sidebar-status">
        <span className="live-dot"/> Sistema online
        <small>Layout premium aplicado</small>
      </div>
    </aside>
    <section className="content premium-content">{view==='client'?<ClientPanel user={user}/>:<AdminPanel/>}</section>
  </main>
}

function AuthScreen({setDemoUser,tab,setTab}){
  const [email,setEmail]=useState('');
  const [password,setPassword]=useState('');
  const [name,setName]=useState('');
  const [cpf,setCpf]=useState('');
  const [phone,setPhone]=useState('');
  const [msg,setMsg]=useState('');

  async function demoLogin(){
    if(tab==='register' && !isValidCpf(cpf)){ setMsg('CPF inválido.'); return; }
    if(tab==='register' && phone.replace(/\D/g,'').length < 10){ setMsg('Telefone obrigatório. Informe DDD + número.'); return; }
    const cpfHash = tab==='register' ? await sha256(onlyDigits(cpf)) : 'demo-cpf-hash';
    const u={ id:'demo-user', email: email||'cliente@demo.com', full_name:name||'Cliente Demo', phone:phone||'(22) 99999-9999', cpf_hash:cpfHash, role:'client', status:'active' };
    localStorage.setItem('inv_cripto_ia_demo_user', JSON.stringify(u));
    setDemoUser(u);
  }

  function friendlyAuthError(message=''){
    const m = String(message || '').toLowerCase();
    if(m.includes('email not confirmed')) return 'Email não confirmado. Confirme o e-mail recebido ou desative a confirmação de e-mail no Supabase durante os testes.';
    if(m.includes('invalid login credentials')) return 'E-mail ou senha inválidos. Confira os dados ou faça um novo cadastro.';
    if(m.includes('user already registered') || m.includes('already registered')) return 'Este e-mail já possui cadastro. Use login ou recupere a senha.';
    if(m.includes('duplicate') || m.includes('cpf')) return 'CPF já cadastrado. Use outro CPF ou acesse a conta existente.';
    return message || 'Erro de autenticação.';
  }

  async function resendConfirmation(){
    setMsg('');
    if(!hasSupabase){ setMsg('Supabase não configurado.'); return; }
    if(!email){ setMsg('Informe o e-mail para reenviar a confirmação.'); return; }
    const { error } = await supabase.auth.resend({ type:'signup', email, options:{ emailRedirectTo: import.meta.env.VITE_APP_URL || window.location.origin } });
    if(error) setMsg(friendlyAuthError(error.message));
    else setMsg('Confirmação reenviada. Verifique sua caixa de entrada e spam.');
  }

  async function submit(e){
    e.preventDefault();
    setMsg('');
    if(!hasSupabase){ await demoLogin(); return; }
    if(tab==='login'){
      const {error}=await supabase.auth.signInWithPassword({email,password});
      if(error) setMsg(friendlyAuthError(error.message));
    } else {
      if(!name.trim()){ setMsg('Nome obrigatório.'); return; }
      if(!isValidCpf(cpf)){ setMsg('CPF inválido.'); return; }
      if(phone.replace(/\D/g,'').length < 10){ setMsg('Telefone obrigatório. Informe DDD + número.'); return; }
      const cpfHash = await sha256(onlyDigits(cpf));
      const metadata = { full_name:name.trim(), phone:phone.trim(), cpf_hash:cpfHash, cpf_masked:maskCpf(cpf) };
      const {data,error}=await supabase.auth.signUp({
        email,
        password,
        options:{ data: metadata, emailRedirectTo: import.meta.env.VITE_APP_URL || window.location.origin }
      });
      if(error){ setMsg(friendlyAuthError(error.message)); return; }
      if(data.user && !data.session){
        setMsg('Cadastro criado. Confirme seu e-mail para conseguir fazer login. Durante testes você pode desativar “Confirm email” no Supabase Auth.');
      } else {
        setMsg('Cadastro criado e login realizado.');
      }
    }
  }

  return <div className="auth-page">
    <div className="auth-card premium-auth">
      <div className="auth-hero">
        <img src="/invcripto-logo.png" alt="INVCRIPTO IA"/>
        <h1>{tab==='login'?'Entrar no INVCRIPTO IA':'Criar conta'}</h1>
        <p>{hasSupabase?'Supabase Auth ativo':'Modo demo local: configure Supabase para produção.'}</p>
      </div>
      <div className="tabs"><button className={tab==='login'?'active':''} type="button" onClick={()=>setTab('login')}>Login</button><button className={tab==='register'?'active':''} type="button" onClick={()=>setTab('register')}>Cadastro</button></div>
      <form onSubmit={submit}>
        {tab==='register' && <><label>Nome</label><input value={name} onChange={e=>setName(e.target.value)} placeholder="Nome completo" required/><label>CPF</label><input value={cpf} onChange={e=>setCpf(maskCpf(e.target.value))} placeholder="000.000.000-00" required/><label>Telefone</label><input value={phone} onChange={e=>setPhone(e.target.value)} placeholder="(22) 99999-9999" required/></>}
        <label>E-mail</label><input value={email} onChange={e=>setEmail(e.target.value)} placeholder="email@dominio.com" required/>
        <label>Senha</label><input type="password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="mínimo 6 caracteres" required/>
        <button className="btn primary auth-submit"><UserRound size={16}/>{tab==='login'?'Entrar':'Cadastrar'}</button>
        {msg && <p className="msg">{msg}</p>}
        {tab==='login' && hasSupabase && String(msg).toLowerCase().includes('email') && <button className="btn ghost full-width" type="button" onClick={resendConfirmation}>Reenviar confirmação de e-mail</button>}
      </form>
    </div>
  </div>
}
