import React, { useEffect, useState } from 'react';
import { supabase, hasSupabase } from './lib/supabase.js';
import { isValidCpf, maskCpf, onlyDigits, sha256 } from './lib/cpf.js';
import ClientPanel from './components/ClientPanel.jsx';
import AdminPanel from './components/AdminPanel.jsx';
import { Bot, Shield, UserRound, LogOut } from 'lucide-react';

const appUrl = (import.meta.env.VITE_APP_URL || 'https://invcripto.netlify.app').replace(/\/$/, '');
const resetUrl = import.meta.env.VITE_PASSWORD_RESET_URL || `${appUrl}/reset-password`;

function formatAuthError(message) {
  const text = String(message || '');
  const lower = text.toLowerCase();
  if (lower.includes('rate limit')) return 'Limite de e-mails do Supabase atingido. Aguarde alguns minutos antes de tentar novamente ou use Login se a conta já existe.';
  if (text === 'Invalid login credentials') return 'E-mail ou senha inválidos. Use "Redefinir senha" para criar uma nova senha.';
  if (lower.includes('already registered') || lower.includes('user already registered')) return 'Este e-mail já está cadastrado. Use Login ou "Redefinir senha".';
  return text;
}

function safeStoredUser() {
  try {
    return JSON.parse(localStorage.getItem('inv_cripto_ia_demo_user') || 'null');
  } catch {
    localStorage.removeItem('inv_cripto_ia_demo_user');
    return null;
  }
}

function persistManualUser(profile, setDemoUser) {
  const manualUser = {
    id: profile.id,
    email: profile.email,
    full_name: profile.full_name,
    phone: profile.phone,
    role: profile.role || 'client',
    status: profile.status || 'active',
    manual_profile: true
  };
  localStorage.setItem('inv_cripto_ia_demo_user', JSON.stringify(manualUser));
  setDemoUser(manualUser);
}

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
  const [demoUser, setDemoUser] = useState(() => safeStoredUser());
  const [tab, setTab] = useState('login');
  const [authNotice, setAuthNotice] = useState('');
  const user = session?.user || demoUser;

  useEffect(() => {
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const errorDescription = hash.get('error_description');
    const type = hash.get('type');
    const isResetPath = window.location.pathname === '/reset-password';
    if (errorDescription) {
      setAuthNotice(errorDescription.includes('expired') ? 'O link de redefinição expirou ou já foi usado. Use a redefinição por CPF abaixo.' : errorDescription);
      setTab('reset');
    } else if (type === 'recovery' || isResetPath) {
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
          <span>Crypto Trading Robot | Paper Trade | Binance Spot</span>
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
    <section className="content premium-content">{view === 'client' ? <ClientPanel user={user}/> : <AdminPanel user={user}/>}</section>
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
  const [confirmPassword, setConfirmPassword] = useState('');

  useEffect(() => {
    if (authNotice) setMsg(authNotice);
  }, [authNotice]);

  function openReset() {
    setMsg('');
    setAuthNotice('');
    setPassword('');
    setNewPassword('');
    setConfirmPassword('');
    setTab('reset');
  }

  function backToLogin() {
    setMsg('');
    setAuthNotice('');
    setPassword('');
    setNewPassword('');
    setConfirmPassword('');
    setTab('login');
  }

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
      const cleanEmail = email.trim().toLowerCase();
      if (!cleanEmail) {
        setMsg('Informe o e-mail cadastrado.');
        return;
      }
      if (!isValidCpf(cpf)) {
        setMsg('Informe o CPF cadastrado para confirmar sua identidade.');
        return;
      }
      if (newPassword.length < 8) {
        setMsg('A nova senha precisa ter no mínimo 8 caracteres.');
        return;
      }
      if (newPassword !== confirmPassword) {
        setMsg('A confirmação da senha não confere.');
        return;
      }
      const cpfHash = await sha256(onlyDigits(cpf));
      const { error } = await supabase.rpc('redefinir_senha_cliente_site', {
        p_email: cleanEmail,
        p_cpf_hash: cpfHash,
        p_new_password: newPassword
      });
      if (error) {
        setMsg(formatAuthError(error.message));
        return;
      }
      setPassword(newPassword);
      setNewPassword('');
      setConfirmPassword('');
      setMsg('Senha redefinida com sucesso. Clique em Entrar para acessar.');
      setTab('login');
    } else if (tab === 'update-password') {
      if (newPassword.length < 8) {
        setMsg('Informe uma nova senha com no mínimo 8 caracteres.');
        return;
      }
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      setMsg(error ? error.message : 'Senha redefinida com sucesso. Você já pode entrar.');
      if (!error) setTab('login');
    } else if (tab === 'login') {
      const cleanEmail = email.trim().toLowerCase();
      const { error } = await supabase.auth.signInWithPassword({ email: cleanEmail, password });
      if (!error) return;
      const manual = await supabase.rpc('login_cliente_site', { p_email: cleanEmail, p_password: password });
      const profile = Array.isArray(manual.data) ? manual.data[0] : null;
      if (!manual.error && profile?.id) {
        persistManualUser(profile, setDemoUser);
        return;
      }
      setMsg(manual.error ? formatAuthError(manual.error.message) : formatAuthError(error.message));
    } else {
      if (!isValidCpf(cpf)) {
        setMsg('CPF inválido.');
        return;
      }
      if (phone.replace(/\D/g, '').length < 10) {
        setMsg('Telefone obrigatório. Informe DDD + número.');
        return;
      }
      const cleanEmail = email.trim().toLowerCase();
      const cleanName = name.trim();
      const cleanPhone = phone.trim();
      const cpfHash = await sha256(onlyDigits(cpf));
      const { data: uid, error } = await supabase.rpc('cadastrar_cliente_site', {
        p_email: cleanEmail,
        p_full_name: cleanName,
        p_phone: cleanPhone,
        p_cpf_hash: cpfHash,
        p_cpf_masked: maskCpf(cpf),
        p_password: password
      });
      if (error) {
        if (String(error.message || '').toLowerCase().includes('rate limit')) {
          const login = await supabase.auth.signInWithPassword({ email: cleanEmail, password });
          if (!login.error) {
            setMsg('Conta já existente. Login realizado com sucesso.');
            return;
          }
        }
        setMsg(formatAuthError(error.message));
        return;
      }
      if (uid) {
        persistManualUser({ id: uid, email: cleanEmail, full_name: cleanName, phone: cleanPhone, role: 'client', status: 'active' }, setDemoUser);
        return;
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
      <div className="tabs"><button className={tab === 'login' ? 'active' : ''} type="button" onClick={backToLogin}>Login</button><button className={tab === 'register' ? 'active' : ''} type="button" onClick={() => setTab('register')}>Cadastro</button></div>
      <form onSubmit={submit}>
        {tab === 'register' && <><label>Nome</label><input value={name} onChange={e => setName(e.target.value)} placeholder="Nome completo" required/><label>CPF</label><input value={cpf} onChange={e => setCpf(maskCpf(e.target.value))} placeholder="000.000.000-00" required/><label>Telefone</label><input value={phone} onChange={e => setPhone(e.target.value)} placeholder="(22) 99999-9999" required/></>}
        {tab !== 'update-password' && <><label>E-mail</label><input value={email} onChange={e => setEmail(e.target.value)} placeholder="email@dominio.com" required/></>}
        {tab === 'reset' && <><label>CPF cadastrado</label><input value={cpf} onChange={e => setCpf(maskCpf(e.target.value))} placeholder="000.000.000-00" required/><label>Nova senha</label><input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} placeholder="mínimo 8 caracteres" required/><label>Confirmar nova senha</label><input type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} placeholder="repita a nova senha" required/></>}
        {tab === 'login' || tab === 'register' ? <><label>Senha</label><input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="mínimo 6 caracteres" required/></> : null}
        {tab === 'update-password' && <><label>Nova senha</label><input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} placeholder="nova senha" required/></>}
        <button className="btn primary auth-submit"><UserRound size={16}/>{tab === 'reset' ? 'Redefinir senha' : tab === 'update-password' ? 'Salvar nova senha' : tab === 'login' ? 'Entrar' : 'Cadastrar'}</button>
        {tab === 'login' && <button className="btn ghost auth-submit" type="button" onClick={openReset}>Redefinir senha</button>}
        {(tab === 'reset' || tab === 'update-password') && <button className="btn ghost auth-submit" type="button" onClick={backToLogin}>Voltar para login</button>}
        {msg && <p className="msg">{msg}</p>}
      </form>
    </div>
  </div>;
}

