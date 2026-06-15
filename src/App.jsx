import React, { useEffect, useState } from 'react';
import { supabase, hasSupabase } from './lib/supabase.js';
import { isValidCpf, maskCpf, maskPhone, onlyDigits, sha256 } from './lib/cpf.js';
import ClientPanel from './components/ClientPanel.jsx';
import AdminPanel from './components/AdminPanel.jsx';
import { Bot, Shield, UserRound } from 'lucide-react';

export default function App() {
  const [session, setSession] = useState(null);
  const [demoUser, setDemoUser] = useState(() => JSON.parse(localStorage.getItem('inv_cripto_ia_demo_user') || 'null'));
  const [profile, setProfile] = useState(null);
  const [tab, setTab] = useState('login');
  const user = profile || session?.user || demoUser;

  useEffect(() => {
    if (!hasSupabase) return;
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, nextSession) => setSession(nextSession));
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function loadProfile() {
      if (!hasSupabase || !session?.user?.id) {
        setProfile(demoUser || null);
        return;
      }
      const { data } = await supabase
        .from('profiles')
        .select('id,email,full_name,phone,role,status')
        .eq('id', session.user.id)
        .maybeSingle();
      if (cancelled) return;
      setProfile({
        ...session.user,
        ...(data || {}),
        id: session.user.id,
        email: data?.email || session.user.email,
        full_name: data?.full_name || session.user.user_metadata?.full_name || '',
        phone: data?.phone || session.user.user_metadata?.phone || '',
        role: data?.role || 'client',
        status: data?.status || 'active'
      });
    }
    loadProfile();
    return () => { cancelled = true; };
  }, [session?.user?.id, demoUser]);

  async function logout() {
    if (hasSupabase) await supabase.auth.signOut();
    localStorage.removeItem('inv_cripto_ia_demo_user');
    setDemoUser(null);
    setProfile(null);
  }

  return <div className="app-shell">
    <header className="topbar">
      <div className="brand"><div className="logo">DF</div><div><strong>INV CRIPTO IA</strong><span>Robo IA Spot + Cesta Inteligente</span></div></div>
      {user && <button className="btn ghost" onClick={logout}>Sair</button>}
    </header>
    {!user ? <AuthScreen setDemoUser={setDemoUser} tab={tab} setTab={setTab} /> : <MainRouter user={user} />}
  </div>;
}

function MainRouter({ user }) {
  const [view, setView] = useState('client');
  const isAdmin = user?.role === 'admin';
  useEffect(() => { if (!isAdmin && view === 'admin') setView('client'); }, [isAdmin, view]);
  return <main className="main">
    <aside className="sidebar">
      <button className={view === 'client' ? 'active' : ''} onClick={() => setView('client')}><Bot size={18} /> Painel Cliente</button>
      {isAdmin && <button className={view === 'admin' ? 'active' : ''} onClick={() => setView('admin')}><Shield size={18} /> Admin</button>}
    </aside>
    <section className="content">{view === 'admin' && isAdmin ? <AdminPanel /> : <ClientPanel user={user} />}</section>
  </main>;
}

function AuthScreen({ setDemoUser, tab, setTab }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [cpf, setCpf] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  async function demoLogin() {
    if (tab === 'register' && !isValidCpf(cpf)) { setMsg('CPF invalido.'); return; }
    const cpfHash = tab === 'register' ? await sha256(onlyDigits(cpf)) : 'demo-cpf-hash';
    const u = { id: 'demo-user', email: email || 'cliente@demo.com', full_name: name || 'Cliente Demo', phone: phone || 'nao informado', cpf_hash: cpfHash, role: 'client', status: 'active' };
    localStorage.setItem('inv_cripto_ia_demo_user', JSON.stringify(u));
    setDemoUser(u);
  }

  async function cpfAlreadyExists(cpfHash) {
    const { data, error } = await supabase.rpc('cpf_hash_exists', { p_cpf_hash: cpfHash });
    if (error) return false; // permite cadastro caso a migration ainda nao tenha sido aplicada; o banco ainda bloqueia duplicidade.
    return Boolean(data);
  }

  async function submit(e) {
    e.preventDefault();
    setMsg('');
    setBusy(true);
    try {
      const cleanEmail = email.trim().toLowerCase();
      if (!cleanEmail || !password) { setMsg('Informe e-mail e senha.'); return; }
      if (password.length < 6) { setMsg('A senha precisa ter no minimo 6 caracteres.'); return; }
      if (!hasSupabase) { await demoLogin(); return; }
      if (tab === 'login') {
        const { error } = await supabase.auth.signInWithPassword({ email: cleanEmail, password });
        if (error) setMsg(error.message);
        return;
      }

      if (!name.trim()) { setMsg('Informe o nome completo.'); return; }
      if (!phone.trim() || onlyDigits(phone).length < 10) { setMsg('Informe um telefone valido.'); return; }
      if (!isValidCpf(cpf)) { setMsg('CPF invalido.'); return; }
      const cpfHash = await sha256(onlyDigits(cpf));
      if (await cpfAlreadyExists(cpfHash)) {
        setMsg('CPF ja cadastrado. Use login ou redefina a senha.');
        return;
      }

      const { data, error } = await supabase.auth.signUp({
        email: cleanEmail,
        password,
        options: {
          data: {
            full_name: name.trim(),
            phone: maskPhone(phone),
            cpf_hash: cpfHash,
            cpf_masked: maskCpf(cpf),
            role: 'client'
          }
        }
      });
      if (error) { setMsg(error.message); return; }

      // O trigger handle_new_auth_user cria profiles, user_documents e inv_wallets no banco.
      // Se a confirmacao de e-mail estiver desligada, tentamos reforcar o documento via RPC autenticada.
      if (data.session?.user?.id) {
        await supabase.rpc('register_my_document', { p_cpf_hash: cpfHash, p_cpf_masked: maskCpf(cpf) }).catch(() => null);
      }
      setMsg('Cadastro criado com sucesso. Se a confirmacao de e-mail estiver ativa, confirme seu e-mail antes do primeiro login.');
    } finally {
      setBusy(false);
    }
  }

  return <div className="auth-card">
    <div className="auth-hero"><UserRound /><h1>{tab === 'login' ? 'Entrar' : 'Criar conta'}</h1><p>{hasSupabase ? 'Supabase Auth ativo' : 'Modo demo local: configure Supabase para producao.'}</p></div>
    <div className="tabs"><button className={tab === 'login' ? 'active' : ''} onClick={() => setTab('login')}>Login</button><button className={tab === 'register' ? 'active' : ''} onClick={() => setTab('register')}>Cadastro</button></div>
    <form onSubmit={submit}>
      {tab === 'register' && <>
        <label>Nome completo</label><input value={name} onChange={e => setName(e.target.value)} placeholder="Nome completo" autoComplete="name" />
        <label>Telefone</label><input value={phone} onChange={e => setPhone(maskPhone(e.target.value))} placeholder="(22) 99999-9999" autoComplete="tel" />
        <label>CPF</label><input value={cpf} onChange={e => setCpf(maskCpf(e.target.value))} placeholder="000.000.000-00" inputMode="numeric" />
      </>}
      <label>E-mail</label><input value={email} onChange={e => setEmail(e.target.value)} placeholder="email@dominio.com" autoComplete="email" />
      <label>Senha</label><input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="minimo 6 caracteres" autoComplete={tab === 'login' ? 'current-password' : 'new-password'} />
      <button className="btn primary" disabled={busy}>{busy ? 'Aguarde...' : tab === 'login' ? 'Entrar' : 'Cadastrar'}</button>
      {msg && <p className="msg">{msg}</p>}
    </form>
  </div>;
}
