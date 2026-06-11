import React, { useEffect, useState } from 'react';
import { supabase, hasSupabase } from './lib/supabase.js';
import { isValidCpf, maskCpf, onlyDigits, sha256 } from './lib/cpf.js';
import ClientPanel from './components/ClientPanel.jsx';
import AdminPanel from './components/AdminPanel.jsx';
import { Bot, Shield, UserRound, LogOut } from 'lucide-react';

const appUrl = (import.meta.env.VITE_APP_URL || 'https://invcripto.netlify.app').replace(/\/$/, '');

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    console.error('INVCRIPTO UI error:', error, info);
  }

  render() {
    if (this.state.hasError) {
      return <div className="app-shell premium-theme"><div className="fallback-screen"><img src="/favicon.png" alt="INVCRIPTO"/><h1>INVCRIPTO IA</h1><p>O painel encontrou um erro de carregamento visual. Atualize a página ou verifique as variáveis do Netlify.</p><button className="btn primary" onClick={() => location.reload()}>Recarregar painel</button><small>{String(this.state.error?.message || 'Erro desconhecido')}</small></div></div>;
    }
    return this.props.children;
  }
}

export default function App() {
  const [session, setSession] = useState(null);
  const [demoUser, setDemoUser] = useState(() => JSON.parse(localStorage.getItem('inv_cripto_ia_demo_user') || 'null'));
  const [tab, setTab] = useState('login');
  const [authNotice, setAuthNotice] = useState('');
  const user = session?.user || demoUser;

  useEffect(() => {
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const errorDescription = hash.get('error_description');
    const type = hash.get('type');
    if (errorDescription) {
      setAuthNotice(errorDescription.includes('expired') ? 'O link de redefinição expirou ou já foi usado. Solicite um novo link abaixo.' : errorDescription);
      setTab('reset');
    } else if (type === 'recovery') {
      setTab('update-password');
    }
  }, []);

  useEffect(() => {
    if (!hasSupabase) return;
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      setSession(session);
      if (event === 'PASSWORD_RECOVERY') setTab('update-password');
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  async function logout() {
    if (hasSupabase) await supabase.auth.signOut();
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
    {!user ? <AuthScreen setDemoUser={setDemoUser} tab={tab} setTab={setTab} authNotice={authNotice} setAuthNotice={setAuthNotice}/> : <MainRouter user={user}/>}
  </div></ErrorBoundary>;
}

function MainRouter({ user }) {
  const [view, setView] = useState('client');
  return <main className="main premium-main">
    <aside className="sidebar premium-sidebar">
      <div className="sidebar-logo-card">
        <img src="/invcripto-logo.png" alt="INVCRIPTO IA"/>
      </div>
      <button className={view === 'client' ? 'active' : ''} onClick={() => setView('client')}><Bot size={18}/> Painel Cliente</button>
      <button className={view === 'admin' ? 'active' : ''} onClick={() => setView('admin')}><Shield size={18}/> Admin</button>
      <div className="sidebar-status">
        <span className="live-dot"/> Sistema online
        <small>Layout premium aplicado</small>
      </div>
    </aside>
    <section className="content premium-content">{view === 'client' ? <ClientPanel user={user}/> : <AdminPanel/>}</section>
  </main>;
}

function AuthScreen({ setDemoUser, tab, setTab, authNotice, setAuthNotice }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [cpf, setCpf] = useState('');
  const [phone, setPhone] = useState('');
  const [msg, setMsg] = useState(authNotice || '');
  const [newPassword, setNewPassword] = useState('');

  useEffect(() => {
    if (authNotice) setMsg(authNotice);
  }, [authNotice]);

  async function demoLogin() {
    if (tab === 'register' && !isValidCpf(cpf)) {
      setMsg('CPF inválido.');
      return;
    }
    if (tab === 'register' && phone.replace(/\D/g, '').length < 10) {
      setMsg('Telefone obrigatório. Informe DDD + número.');
      return;
    }
    const cpfHash = tab === 'register' ? await sha256(onlyDigits(cpf)) : 'demo-cpf-hash';
    const u = { id: 'demo-user', email: email || 'cliente@demo.com', full_name: name || 'Cliente Demo', phone: phone || '(22) 99999-9999', cpf_hash: cpfHash, role: 'client', status: 'active' };
    localStorage.setItem('inv_cripto_ia_demo_user', JSON.stringify(u));
    setDemoUser(u);
  }

  async function submit(e) {
    e.preventDefault();
    setMsg('');
    setAuthNotice('');
    if (!hasSupabase) {
      await demoLogin();
      return;
    }

    if (tab === 'reset') {
      const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${appUrl}/?type=recovery` });
      setMsg(error ? error.message : 'Enviamos o link de redefinição para seu e-mail. Abra o link mais recente recebido.');
    } else if (tab === 'update-password') {
      if (newPassword.length < 6) {
        setMsg('Informe uma nova senha com no mínimo 6 caracteres.');
        return;
      }
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      setMsg(error ? error.message : 'Senha redefinida com sucesso. Você já pode entrar.');
      if (!error) setTab('login');
    } else if (tab === 'login') {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) setMsg(error.message === 'Invalid login credentials' ? 'E-mail ou senha inválidos. Use “Esqueci minha senha” para redefinir.' : error.message);
    } else {
      if (!isValidCpf(cpf)) {
        setMsg('CPF inválido.');
        return;
      }
      if (phone.replace(/\D/g, '').length < 10) {
        setMsg('Telefone obrigatório. Informe DDD + número.');
        return;
      }
      const cpfHash = await sha256(onlyDigits(cpf));
      const { data, error } = await supabase.auth.signUp({ email, password });
      if (error) {
        setMsg(error.message);
        return;
      }
      const uid = data.user?.id;
      if (uid) {
        await supabase.from('profiles').insert({ id: uid, email, full_name: name, phone, role: 'client', status: 'active' });
        const doc = await supabase.from('user_documents').insert({ user_id: uid, cpf_hash: cpfHash, cpf_masked: maskCpf(cpf) });
        if (doc.error) {
          setMsg('CPF já cadastrado ou erro no documento.');
          return;
        }
        await supabase.rpc('credit_inv', { p_user_id: uid, p_amount: 10, p_type: 'initial_bonus', p_description: 'Bônus inicial de cadastro' });
      }
      setMsg('Cadastro criado. Verifique seu e-mail se a confirmação estiver ativa.');
    }
  }

  const title = tab === 'reset' ? 'Redefinir senha' : tab === 'update-password' ? 'Criar nova senha' : tab === 'login' ? 'Entrar no INVCRIPTO IA' : 'Criar conta';
  return <div className="auth-page">
    <div className="auth-card premium-auth">
      <div className="auth-hero">
        <img src="/invcripto-logo.png" alt="INVCRIPTO IA"/>
        <h1>{title}</h1>
        <p>{hasSupabase ? 'Supabase Auth ativo' : 'Modo demo local: configure Supabase para produção.'}</p>
      </div>
      <div className="tabs"><button className={tab === 'login' ? 'active' : ''} type="button" onClick={() => setTab('login')}>Login</button><button className={tab === 'register' ? 'active' : ''} type="button" onClick={() => setTab('register')}>Cadastro</button></div>
      <form onSubmit={submit}>
        {tab === 'register' && <><label>Nome</label><input value={name} onChange={e => setName(e.target.value)} placeholder="Nome completo" required/><label>CPF</label><input value={cpf} onChange={e => setCpf(maskCpf(e.target.value))} placeholder="000.000.000-00" required/><label>Telefone</label><input value={phone} onChange={e => setPhone(e.target.value)} placeholder="(22) 99999-9999" required/></>}
        {tab !== 'update-password' && <><label>E-mail</label><input value={email} onChange={e => setEmail(e.target.value)} placeholder="email@dominio.com" required/></>}
        {tab === 'login' || tab === 'register' ? <><label>Senha</label><input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="mínimo 6 caracteres" required/></> : null}
        {tab === 'update-password' && <><label>Nova senha</label><input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} placeholder="nova senha" required/></>}
        <button className="btn primary auth-submit"><UserRound size={16}/>{tab === 'reset' ? 'Enviar link' : tab === 'update-password' ? 'Salvar nova senha' : tab === 'login' ? 'Entrar' : 'Cadastrar'}</button>
        {tab === 'login' && <button className="btn ghost auth-submit" type="button" onClick={() => setTab('reset')}>Esqueci minha senha</button>}
        {(tab === 'reset' || tab === 'update-password') && <button className="btn ghost auth-submit" type="button" onClick={() => setTab('login')}>Voltar para login</button>}
        {msg && <p className="msg">{msg}</p>}
      </form>
    </div>
  </div>;
}
