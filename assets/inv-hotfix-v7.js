/* INVCRIPTO IA v7: anti tela branca + ENV card + deploy root/dist seguro */
(function(){
  const STORAGE_KEY = 'df_paper_state';
  const fmt = (n) => Number(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  function readState(){ try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') || {}; } catch { return {}; } }
  function writeState(s){ try { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); } catch {} }
  function requestTopUp(){
    const raw = window.prompt('Quantos ENV deseja adicionar? 1 ENV = US$ 1,00', '10');
    if (raw === null) return;
    const amount = Number(String(raw).replace(',', '.'));
    if (!Number.isFinite(amount) || amount <= 0) { window.alert('Informe um valor válido em ENV.'); return; }
    const st = readState();
    const current = Number(st.envBalance ?? st.invBalance ?? 10);
    st.envBalance = current + amount;
    st.invBalance = st.envBalance;
    writeState(st);
    document.querySelectorAll('[data-env-balance]').forEach(el => el.textContent = `${fmt(st.envBalance)} ENV`);
    window.alert(`Solicitação registrada: ${fmt(amount)} ENV. No Pix futuro, o valor será convertido pela cotação USDT/BRL do momento.`);
    setTimeout(() => location.reload(), 250);
  }
  function ensureEnvCard(){
    const strip = document.querySelector('.kpi-strip');
    if (!strip || strip.querySelector('.env-kpi-hotfix')) return;
    const st = readState();
    const balance = Number(st.envBalance ?? st.invBalance ?? 10);
    const card = document.createElement('div');
    card.className = 'mini-kpi env-kpi-hotfix';
    card.innerHTML = `<div class="kpi-icon">ENV</div><span>Saldo ENV</span><strong data-env-balance>${fmt(balance)} ENV</strong><small>1 ENV = US$ 1,00</small><button type="button" class="btn small env-add-btn">Adicionar saldo</button>`;
    card.querySelector('button')?.addEventListener('click', requestTopUp);
    const first = strip.querySelector('.mini-kpi');
    if(first) first.after(card); else strip.prepend(card);
  }
  function ensureInvButton(){
    const headings = Array.from(document.querySelectorAll('.panel h3, .panel-glow h3'));
    const heading = headings.find(h => /Créditos ENV|Saldo ENV/i.test(h.textContent || ''));
    if (!heading) return;
    const panel = heading.closest('.panel, .panel-glow');
    if (!panel || panel.querySelector('.env-add-panel-btn')) return;
    const btn = document.createElement('button');
    btn.className = 'btn primary gold-btn env-add-panel-btn';
    btn.type = 'button';
    btn.textContent = 'Adicionar saldo';
    btn.addEventListener('click', requestTopUp);
    const alert = panel.querySelector('.alert');
    panel.insertBefore(btn, alert || null);
  }
  function chartSafety(){
    document.querySelectorAll('.native-chart').forEach(svg=>{
      svg.style.overflow='visible';
      svg.querySelectorAll('text.chart-label').forEach(t=>{
        t.setAttribute('paint-order','stroke');
        t.setAttribute('stroke-linejoin','round');
      });
    });
  }
  function showFallbackIfBlank(){
    const root = document.getElementById('root');
    if (!root) return;
    const text = (root.textContent || '').trim();
    const hasReact = !!root.querySelector('.app-shell,.robot-dashboard,.auth-page');
    if (!hasReact && (!root.children.length || /Carregando painel premium/i.test(text))) {
      root.innerHTML = `<div class="app-shell premium-theme"><div class="fallback-screen"><img src="/favicon.png" alt="INVCRIPTO IA"><h1>INVCRIPTO IA</h1><p>O painel não conseguiu inicializar o JavaScript principal. Esta versão v7 já inclui index de produção na raiz e em dist; faça Clear cache and deploy site no Netlify.</p><button class="btn primary" onclick="location.reload()">Recarregar painel</button></div></div>`;
    }
  }
  function run(){ ensureEnvCard(); ensureInvButton(); chartSafety(); }
  window.INVCRIPTO_ENV_TOPUP = requestTopUp;
  window.addEventListener('error', function(e){ console.error('INVCRIPTO runtime error:', e.message, e.error); });
  window.addEventListener('unhandledrejection', function(e){ console.error('INVCRIPTO promise error:', e.reason); });
  document.addEventListener('DOMContentLoaded', function(){
    run();
    const obs = new MutationObserver(run);
    obs.observe(document.body, { childList:true, subtree:true });
    setTimeout(run, 500); setTimeout(run, 1500); setTimeout(run, 3000);
    setTimeout(showFallbackIfBlank, 6000);
  });
})();
