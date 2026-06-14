import React, { useEffect, useState } from 'react';
import { supabase, hasSupabase } from './lib/supabase.js';
import { isValidCpf, maskCpf, onlyDigits, sha256 } from './lib/cpf.js';
import ClientPanel, { Training } from './components/ClientPanel.jsx';
import AdminPanel from './components/AdminPanel.jsx';
import { Bell, Bot, BookOpen, CheckCircle2, Clock3, DollarSign, Download, ExternalLink, Shield, UserRound, LogOut, Wallet } from 'lucide-react';

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
  const simpleOpsMode = window.location.pathname === '/operacoes';

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
    {!user ? <AuthScreen setDemoUser={setDemoUser} tab={tab} setTab={setTab} authNotice={authNotice} setAuthNotice={setAuthNotice}/> : simpleOpsMode ? <SimpleOperationsApp user={user}/> : <MainRouter user={user}/>} 
  </div></ErrorBoundary>;
}

function SimpleOperationsApp({ user }) {
  const [orders, setOrders] = useState([]);
  const [profits, setProfits] = useState([]);
  const [accountStatus, setAccountStatus] = useState({ connected: false, usdtFree: 0, usdtLocked: 0, envBalance: 0 });
  const [loading, setLoading] = useState(true);
  const [lastSync, setLastSync] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [installPrompt, setInstallPrompt] = useState(null);
  const [appInstalled, setAppInstalled] = useState(() => window.matchMedia?.('(display-mode: standalone)').matches || window.navigator?.standalone);
  const [notificationsAllowed, setNotificationsAllowed] = useState(() => typeof Notification !== 'undefined' && Notification.permission === 'granted');
  const seenProfitsRef = React.useRef(new Set(JSON.parse(localStorage.getItem('inv_simple_seen_profits') || '[]')));

  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    }
    const onBeforeInstall = event => {
      event.preventDefault();
      setInstallPrompt(event);
    };
    const onInstalled = () => {
      setAppInstalled(true);
      setInstallPrompt(null);
      setNotice('App instalado com sucesso.');
    };
    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  async function requestNotifications() {
    if (typeof Notification === 'undefined') {
      setNotice('Este navegador não suporta notificação nativa.');
      return;
    }
    const permission = await Notification.requestPermission();
    setNotificationsAllowed(permission === 'granted');
    setNotice(permission === 'granted' ? 'Notificações ativadas para lucros fechados.' : 'Permissão de notificação não liberada no navegador.');
  }

  async function installApp() {
    if (appInstalled) {
      setNotice('O app já está instalado neste navegador.');
      return;
    }
    if (!installPrompt) {
      setNotice('Se o botão de instalação do navegador aparecer na barra de endereço, use ele para instalar o app. No celular, use "Adicionar à tela inicial".');
      return;
    }
    installPrompt.prompt();
    const choice = await installPrompt.userChoice.catch(() => null);
    if (choice?.outcome === 'accepted') {
      setAppInstalled(true);
      setNotice('Instalação iniciada. O INVCRIPTO ficará disponível como app.');
    } else {
      setNotice('Instalação cancelada pelo navegador.');
    }
    setInstallPrompt(null);
  }

  function emitProfitNotification(event) {
    const profit = Number(event.profitUsd || 0);
    if (profit <= 0) return;
    const title = `Lucro líquido fechado: ${event.symbol || 'INVCRIPTO'}`;
    const body = `Resultado líquido +$${profit.toFixed(2)} USDT após taxas Binance. Taxa ENV: ${Number(event.feeEnv || 0).toFixed(2)}.`;
    setNotice(`${title} - ${body}`);
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      new Notification(title, { body, icon: '/favicon.png', badge: '/favicon.png' });
    }
  }

  async function loadOperations({ initial = false } = {}) {
    if (!hasSupabase || !user?.id) {
      setError('Entre com uma conta conectada ao Supabase para ver operações reais.');
      setLoading(false);
      return;
    }
    try {
      setError('');
      const { data } = await supabase.auth.getSession();
      const token = data?.session?.access_token;
      const manualUserId = user?.manual_profile ? user.id : null;
      const requestBody = { manualUserId, manualEmail: user?.email || '', environment: 'live' };
      const response = await fetch('/.netlify/functions/binance-real-orders', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ ...requestBody, limit: 100 })
      });
      const statusResponse = await fetch('/.netlify/functions/binance-status', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify(requestBody)
      });
      const payload = await response.json().catch(() => ({}));
      const statusPayload = await statusResponse.json().catch(() => ({}));
      if (!response.ok || !payload?.ok) throw new Error(payload.error || 'Não foi possível carregar operações.');
      if (statusResponse.ok && statusPayload?.ok) {
        setAccountStatus({
          connected: Boolean(statusPayload.connected),
          canTrade: Boolean(statusPayload.canTrade),
          credentialStatus: statusPayload.credentialStatus || '',
          usdtFree: Number(statusPayload.usdtFree || 0),
          usdtLocked: Number(statusPayload.usdtLocked || 0),
          envBalance: Number(statusPayload.envBalance || 0),
          lastTestAt: statusPayload.lastTestAt || null
        });
      }
      const nextProfits = Array.isArray(payload.profitEvents) ? payload.profitEvents : [];
      setOrders(Array.isArray(payload.orders) ? payload.orders : []);
      setProfits(nextProfits);
      setLastSync(new Date());
      if (!initial) {
        nextProfits.forEach(event => {
          const key = `${event.at}:${event.symbol}:${event.profitUsd}`;
          if (!seenProfitsRef.current.has(key) && Number(event.profitUsd || 0) > 0) {
            seenProfitsRef.current.add(key);
            emitProfitNotification(event);
          }
        });
        localStorage.setItem('inv_simple_seen_profits', JSON.stringify([...seenProfitsRef.current].slice(-200)));
      } else {
        nextProfits.forEach(event => seenProfitsRef.current.add(`${event.at}:${event.symbol}:${event.profitUsd}`));
        localStorage.setItem('inv_simple_seen_profits', JSON.stringify([...seenProfitsRef.current].slice(-200)));
      }
    } catch (err) {
      setError(String(err?.message || err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadOperations({ initial: true });
    const timer = setInterval(() => loadOperations(), 10000);
    return () => clearInterval(timer);
  }, [user?.id]);

  const closedProfit = profits.reduce((sum, item) => sum + Number(item.profitUsd || 0), 0);
  const fees = profits.reduce((sum, item) => sum + Number(item.feeEnv || 0), 0);
  const totalUsdt = Number(accountStatus.usdtFree || 0) + Number(accountStatus.usdtLocked || 0);
  const openSells = orders.filter(order => String(order.rawSide || order.side || '').toUpperCase().includes('SELL') && ['new', 'open', 'partially_filled'].includes(String(order.status || 'new').toLowerCase()));
  const recent = [...profits.map(item => ({ ...item, type: 'profit' })), ...orders.map(item => ({ ...item, type: 'order' }))]
    .sort((a, b) => new Date(b.at || 0) - new Date(a.at || 0))
    .slice(0, 40);

  return <main className="simple-ops">
    <section className="simple-ops-hero">
      <div>
        <p className="eyebrow">App de operações</p>
        <h1>Operações INVCRIPTO</h1>
        <p>Monitoramento resumido da conta real, com alerta quando uma operação fechar com lucro.</p>
      </div>
      <div className="simple-ops-actions">
        <a className="btn ghost" href="/"><ExternalLink size={16}/> Painel completo</a>
        <button className="btn ghost" type="button" onClick={installApp}><Download size={16}/>{appInstalled ? 'App instalado' : 'Instalar app'}</button>
        <button className="btn primary" type="button" onClick={requestNotifications}><Bell size={16}/>{notificationsAllowed ? 'Notificações ativas' : 'Ativar notificações'}</button>
      </div>
    </section>
    {notice && <div className="alert simple-profit-alert"><CheckCircle2 size={18}/>{notice}</div>}
    {error && <div className="alert danger">{error}</div>}
    <section className="simple-kpis">
      <div className="mini-kpi"><Wallet className="kpi-icon"/><span>Saldo real Binance</span><strong>${totalUsdt.toFixed(2)} USDT</strong><small>{accountStatus.connected ? `${Number(accountStatus.usdtFree || 0).toFixed(2)} livre | ${Number(accountStatus.usdtLocked || 0).toFixed(2)} em ordem` : 'API não conectada'}</small></div>
      <div className="mini-kpi"><DollarSign className="kpi-icon"/><span>Lucro líquido fechado</span><strong>${closedProfit.toFixed(2)}</strong><small>Após taxas Binance | {fees.toFixed(2)} ENV</small></div>
      <div className="mini-kpi"><CheckCircle2 className="kpi-icon"/><span>Vendas protegidas</span><strong>{openSells.length}</strong><small>Ordens abertas na Binance</small></div>
      <div className="mini-kpi"><Shield className="kpi-icon"/><span>ENV disponível</span><strong>{Number(accountStatus.envBalance || 0).toFixed(2)} ENV</strong><small>{accountStatus.canTrade ? 'Trading habilitado' : accountStatus.connected ? 'Somente leitura' : 'Aguardando API'}</small></div>
      <div className="mini-kpi"><Clock3 className="kpi-icon"/><span>Última atualização</span><strong>{lastSync ? lastSync.toLocaleTimeString('pt-BR') : loading ? 'Carregando' : '-'}</strong><small>Atualiza a cada 10 segundos</small></div>
    </section>
    <section className="panel panel-glow simple-ops-list">
      <div className="simple-section-head">
        <h3>Operações e lucros</h3>
        <button className="btn ghost small" type="button" onClick={() => loadOperations()}>Atualizar agora</button>
      </div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Hora</th><th>Tipo</th><th>Ativo</th><th>Status</th><th>Preço</th><th>Valor</th><th>Lucro</th><th>Taxa ENV</th></tr></thead>
          <tbody>
            {recent.map((item, index) => <tr key={`${item.type}-${item.id || item.at}-${index}`} className={item.type === 'profit' ? 'profit-row' : ''}>
              <td>{item.at ? new Date(item.at).toLocaleString('pt-BR') : '-'}</td>
              <td>{item.type === 'profit' ? 'Lucro líquido' : item.side}</td>
              <td>{String(item.symbol || '').replace('USDT', '/USDT')}</td>
              <td>{item.type === 'profit' ? 'Finalizada' : item.status || '-'}</td>
              <td>{item.price ? Number(item.price).toFixed(4) : '-'}</td>
              <td>{item.valueUsd ? `$${Number(item.valueUsd).toFixed(2)}` : '-'}</td>
              <td>{item.profitUsd ? `$${Number(item.profitUsd).toFixed(2)}` : '-'}</td>
              <td>{item.feeEnv ? Number(item.feeEnv).toFixed(2) : '-'}</td>
            </tr>)}
            {!recent.length && <tr><td colSpan="8" className="muted">Nenhuma operação encontrada ainda.</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  </main>;
}

function MainRouter({ user }) {
  const [view, setView] = useState('client');
  return <main className="main premium-main">
    <aside className="sidebar premium-sidebar">
      <div className="sidebar-logo-card">
        <img src="/invcripto-logo.png" alt="INVCRIPTO IA"/>
      </div>
      <button className={view === 'client' ? 'active' : ''} onClick={() => setView('client')}><Bot size={18}/> Painel Cliente</button>
      <button className={view === 'guide' ? 'active' : ''} onClick={() => setView('guide')}><BookOpen size={18}/> Guia de instalação</button>
      <button className={view === 'admin' ? 'active' : ''} onClick={() => setView('admin')}><Shield size={18}/> Admin</button>
      <div className="sidebar-status">
        <span className="live-dot"/> Sistema online
        <small>Layout premium aplicado</small>
      </div>
    </aside>
    <section className="content premium-content">{view === 'client' ? <ClientPanel user={user}/> : view === 'guide' ? <Training/> : <AdminPanel user={user}/>}</section>
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

