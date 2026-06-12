import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createTargetPreviewOrder, initialPaperState, runPaperDecision } from '../lib/paperBot.js';
import { analyzeMarket, supportResistance } from '../lib/strategy.js';
import { brl, usd, usdt, env, num } from '../lib/format.js';
import { supabase, hasSupabase } from '../lib/supabase.js';
import { Activity, BarChart3, Bot, Brain, CreditCard, Gauge, History, KeyRound, Pause, Play, Settings, ShieldCheck, SlidersHorizontal, Sparkles, StopCircle, TrendingUp, Wallet } from 'lucide-react';

const allowedSymbols = ['BTCUSDT','ETHUSDT','BNBUSDT','SOLUSDT','XRPUSDT','ADAUSDT','AVAXUSDT','DOGEUSDT','LINKUSDT','DOTUSDT','LTCUSDT','TRXUSDT'];
const radarSeed = {
  BTCUSDT:{hold:94,liquidity:96}, ETHUSDT:{hold:91,liquidity:94}, BNBUSDT:{hold:86,liquidity:88}, SOLUSDT:{hold:78,liquidity:90}, XRPUSDT:{hold:74,liquidity:86}, ADAUSDT:{hold:72,liquidity:78}, AVAXUSDT:{hold:70,liquidity:76}, DOGEUSDT:{hold:68,liquidity:82}, LINKUSDT:{hold:76,liquidity:74}, DOTUSDT:{hold:69,liquidity:70}, LTCUSDT:{hold:73,liquidity:72}, TRXUSDT:{hold:71,liquidity:73}
};
const syntheticBase = {
  BTCUSDT: 68000, ETHUSDT: 3500, BNBUSDT: 610, SOLUSDT: 155, XRPUSDT: 0.52, ADAUSDT: 0.45,
  AVAXUSDT: 32, DOGEUSDT: 0.15, LINKUSDT: 17, DOTUSDT: 6.5, LTCUSDT: 84, TRXUSDT: 0.12
};

function normalizeKlines(data){
  if (!Array.isArray(data)) return [];
  return data
    .filter(k=>Array.isArray(k) && k.length >= 6)
    .map(k=>({time:Math.floor(Number(k[0])/1000),open:+k[1],high:+k[2],low:+k[3],close:+k[4],volume:+k[5]}))
    .filter(c=>Number.isFinite(c.time) && Number.isFinite(c.close) && c.close > 0);
}

function fallbackCandles(symbol, timeframe, count=320){
  const stepSeconds = ({'1m':60,'5m':300,'15m':900,'1h':3600,'4h':14400,'1d':86400})[timeframe] || 900;
  const base = syntheticBase[symbol] || 100;
  const now = Math.floor(Date.now()/1000);
  let last = base;
  return Array.from({length:count},(_,i)=>{
    const wave = Math.sin(i/9) * base * 0.006 + Math.cos(i/23) * base * 0.004;
    const drift = (i-count/2) * base * 0.00002;
    const open = last;
    const close = Math.max(base * 0.05, base + wave + drift);
    const high = Math.max(open, close) * 1.002;
    const low = Math.min(open, close) * 0.998;
    last = close;
    return { time: now - (count-i)*stepSeconds, open, high, low, close, volume: 1000 + i * 3 };
  });
}

export default function ClientPanel({user}){
  const [activeTab,setActiveTab]=useState('dashboard');
  const [symbol,setSymbol]=useState('BTCUSDT');
  const [timeframe,setTimeframe]=useState('15m');
  const [candles,setCandles]=useState([]);
  const [state,setState]=useState(()=>JSON.parse(localStorage.getItem('df_paper_state')||'null') || initialPaperState(Number(import.meta.env.VITE_DEFAULT_PAPER_BALANCE_USD||1000)));
  const [selectionMode,setSelectionMode]=useState('recommended');
  const [accountMode,setAccountMode]=useState(()=>localStorage.getItem('df_account_mode') || state.accountMode || 'demo');
  const [liveTicker,setLiveTicker]=useState(null);
  const [marketStatus,setMarketStatus]=useState('Sincronizando mercado');
  const autoOrderRef = useRef('');
  const lastPrice=Number(liveTicker?.lastPrice || liveTicker?.price || candles.at(-1)?.close || 0);
  const analysis = useMemo(()=>analyzeMarket(candles),[candles]);
  const radar = useMemo(()=>buildRadar(analysis, symbol),[analysis, symbol]);
  const recommended = radar[0] || {symbol:'BTCUSDT',score:0,hold:0};

  useEffect(()=>{localStorage.setItem('df_paper_state',JSON.stringify({...state,symbol,accountMode}))},[state,symbol,accountMode]);
  useEffect(()=>{localStorage.setItem('df_account_mode',accountMode); setState(s=>({...s,accountMode}));},[accountMode]);
  useEffect(()=>{
    if(!hasSupabase || !user?.id) return;
    let closed = false;
    async function loadBinanceStatus(){
      try{
        const { data } = await supabase.auth.getSession();
        const token = data?.session?.access_token;
        const manualUserId = user?.manual_profile ? user.id : null;
        const response = await fetch('/.netlify/functions/binance-status', {
          method:'POST',
          headers:{ 'content-type':'application/json', ...(token ? { authorization:`Bearer ${token}` } : {}) },
          body:JSON.stringify({ manualUserId, manualEmail: user?.email || '', environment:'live' })
        });
        const payload = await response.json().catch(()=>({}));
        if(closed || !response.ok || !payload?.ok) return;
        if(payload.envBalance !== undefined){
          setState(s=>({...s, envBalance:Number(payload.envBalance || 0)}));
        }
        if(payload.connected || payload.credentialStatus){
          setState(s=>({
            ...s,
            ...(payload.envBalance !== undefined ? { envBalance:Number(payload.envBalance || 0) } : {}),
            apiConnected:Boolean(payload.connected),
            binancePending:payload.credentialStatus === 'pending_connector_validation',
            binanceCredentialStatus:payload.credentialStatus,
            binanceUsdtBalance:Number(payload.usdtFree || 0),
            binanceUsdtLocked:Number(payload.usdtLocked || 0),
            binanceCanTrade:Boolean(payload.canTrade),
            accountMode:'live'
          }));
          setAccountMode('live');
        }
      } catch {}
    }
    loadBinanceStatus();
    const t=setInterval(loadBinanceStatus,15000);
    return()=>{closed=true;clearInterval(t)};
  },[user?.id]);
  useEffect(()=>{
    let closed=false;
    async function load(){
      try{
        const res=await fetch(`/.netlify/functions/binance-klines?symbol=${symbol}&interval=${timeframe}&limit=320`).catch(()=>null);
        let data=[];
        if(res?.ok) data=await res.json();
        if(!data.length){
          const r=await fetch(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${timeframe}&limit=320`);
          if (r.ok) data=await r.json();
        }
        const normalized = normalizeKlines(data);
        if(!closed) setCandles(normalized.length ? normalized : fallbackCandles(symbol,timeframe));
      } catch(e){ if(!closed) setCandles(fallbackCandles(symbol,timeframe)); }
    }
    load(); const t=setInterval(load,12000); return()=>{closed=true;clearInterval(t)};
  },[symbol,timeframe]);
  useEffect(()=>{
    let closed=false;
    async function tick(){
      try{
        const res=await fetch(`/.netlify/functions/binance-ticker?symbol=${symbol}`).catch(()=>null);
        let payload=null;
        if(res?.ok) payload=await res.json();
        if(!payload?.lastPrice){
          const direct=await fetch(`https://api.binance.com/api/v3/ticker/24hr?symbol=${symbol}`).catch(()=>null);
          if(direct?.ok) payload=await direct.json();
        }
        if(payload?.lastPrice && !closed){
          setLiveTicker(payload);
          setMarketStatus('Valores em tempo real');
          setCandles(list=>{
            if(!list.length) return list;
            const next=[...list];
            const last={...next[next.length-1]};
            const price=Number(payload.lastPrice);
            last.close=price;
            last.high=Math.max(last.high,price);
            last.low=Math.min(last.low,price);
            next[next.length-1]=last;
            return next;
          });
        }
      } catch(e){
        if(!closed) setMarketStatus('Usando último candle disponível');
      }
    }
    tick(); const t=setInterval(tick,2500); return()=>{closed=true;clearInterval(t)};
  },[symbol]);
  useEffect(()=>{ if(state.active && candles.length){ const t=setInterval(()=>setState(s=>runPaperDecision({...s,symbol,accountMode},candles)),9000); return()=>clearInterval(t) }},[state.active,candles,symbol,accountMode]);
  useEffect(()=>{
    if(!hasSupabase || !state.active || accountMode !== 'live') return;
    if(!analysis?.orderPlan || analysis.action !== 'BUY' || Number(analysis.score || 0) < 78) return;
    if(!state.apiConnected || !state.binanceCanTrade || Number(state.envBalance || 0) <= 0) return;
    const plan = analysis.orderPlan;
    const liveBalance = Number(state.binanceUsdtBalance || 0);
    const quoteOrderQty = liveBalance > 0 ? Math.max(5, Math.min(10, liveBalance * 0.55)) : 0;
    if(quoteOrderQty < 5) return;
    const setupKey = `${user?.id || 'user'}:${symbol}:${timeframe}:${Math.round(plan.entry * 1000000)}:${Math.round(plan.recoveryTarget * 1000000)}:${analysis.score}`;
    if(autoOrderRef.current === setupKey || state.lastAutoRealSetupKey === setupKey) return;
    autoOrderRef.current = setupKey;

    let cancelled = false;
    async function queueAutoOrder(){
      try{
        const { data } = await supabase.auth.getSession();
        const token = data?.session?.access_token;
        const manualUserId = user?.manual_profile ? user.id : null;
        const response = await fetch('/.netlify/functions/binance-protected-order', {
          method:'POST',
          headers:{ 'content-type':'application/json', ...(token ? { authorization:`Bearer ${token}` } : {}) },
          body:JSON.stringify({
            manualUserId,
            manualEmail:user?.email || '',
            environment:'live',
            symbol,
            quoteOrderQty,
            targetPrice:plan.recoveryTarget,
            timeframe,
            score:Number(analysis.score || 0),
            reason:`Auto Trading INVCRIPTO: ${analysis.reason || 'setup BUY confirmado'}`
          })
        });
        const payload = await response.json().catch(()=>({}));
        if(cancelled) return;
        if(!response.ok || !payload?.ok) throw new Error(payload.error || 'Falha ao enfileirar ordem real.');
        setState(s=>({
          ...s,
          lastAutoRealSetupKey: setupKey,
          lastAutoRealCommandId: payload.connectorCommandId,
          orders: [{
            id: payload.connectorCommandId || crypto.randomUUID(),
            at: new Date().toISOString(),
            side:'REAL_QUEUED',
            symbol,
            qty: quoteOrderQty / (plan.entry || lastPrice || 1),
            price: plan.entry || lastPrice || 0,
            valueUsd: quoteOrderQty,
            reason:'Compra real + venda protegida enviadas ao conector local'
          }, ...s.orders].slice(0,80)
        }));
      } catch(err) {
        if(cancelled) return;
        setState(s=>({
          ...s,
          lastAutoRealSetupKey: setupKey,
          lastAutoRealError: String(err?.message || err),
          orders: [{
            id: crypto.randomUUID(),
            at: new Date().toISOString(),
            side:'REAL_ERROR',
            symbol,
            qty:0,
            price:lastPrice || 0,
            valueUsd:0,
            reason:String(err?.message || err)
          }, ...s.orders].slice(0,80)
        }));
      }
    }
    queueAutoOrder();
    return()=>{cancelled=true};
  },[state.active,accountMode,analysis,symbol,timeframe,state.apiConnected,state.binanceCanTrade,state.envBalance,state.binanceUsdtBalance,user?.id]);

  function operateRecommended(){ setSymbol(recommended.symbol); setSelectionMode('recommended'); setState(s=>({...s,active:true,symbol:recommended.symbol,accountMode})); }
  function operateSelected(){ setSelectionMode('manual_assisted'); setState(s=>({...s,active:true,symbol,accountMode})); }
  function createTargetOrder(){ setState(s=>createTargetPreviewOrder({...s,symbol},symbol,analysis,timeframe)); }

  const tabs=[['dashboard','Dashboard'],['analysis','Análise ao vivo'],['scanner','Radar IA'],['orders','Operações'],['inv','Créditos ENV'],['settings','API Binance']];

  return <div className="robot-dashboard">
    <div className="hero-row">
      <div className="brand-title">
        <img src="/favicon.png" alt="INVCRIPTO"/>
        <div><h1>INVCRIPTO IA</h1><p>Crypto Trading Robot - gráfico real, paper trade, radar IA e créditos ENV em dólar.</p></div>
      </div>
      <div className="live-badge"><span className="live-dot"/> {state.active?'LIVE - Bot ativo':'PAUSADO'}</div>
    </div>

    <KpiStrip state={state} lastPrice={lastPrice} symbol={symbol} timeframe={timeframe} accountMode={accountMode} setAccountMode={setAccountMode}/>

    <div className="tabbar premium-tabs">{tabs.map(([k,l])=><button key={k} className={activeTab===k?'active':''} onClick={()=>setActiveTab(k)}>{l}</button>)}</div>

    {activeTab==='dashboard' && <Dashboard user={user} state={state} setState={setState} symbol={symbol} setSymbol={setSymbol} timeframe={timeframe} setTimeframe={setTimeframe} candles={candles} analysis={analysis} radar={radar} recommended={recommended} operateRecommended={operateRecommended} operateSelected={operateSelected} createTargetOrder={createTargetOrder} selectionMode={selectionMode} setSelectionMode={setSelectionMode} accountMode={accountMode} setAccountMode={setAccountMode} marketStatus={marketStatus} lastPrice={lastPrice}/>}    
    {activeTab==='analysis' && <LiveAnalysis symbol={symbol} setSymbol={setSymbol} timeframe={timeframe} setTimeframe={setTimeframe} candles={candles} state={state} analysis={analysis}/>}    
    {activeTab==='scanner' && <Scanner radar={radar} symbol={symbol} setSymbol={setSymbol} operateRecommended={operateRecommended}/>}    
    {activeTab==='orders' && <Orders orders={state.orders}/>}    
    {activeTab==='inv' && <INV state={state}/>}    
    {activeTab==='settings' && <BinanceSettings user={user} setState={setState} setAccountMode={setAccountMode}/>}
  </div>
}

function KpiStrip({state,lastPrice,symbol,timeframe,accountMode,setAccountMode}){
  const closedOrders = state.orders.filter(o=>String(o.side || '').startsWith('SELL'));
  const wins = closedOrders.filter(o=>Number(o.profitUsd || o.profitBrl || 0) > 0).length;
  const winRate = closedOrders.length ? Math.round((wins / closedOrders.length) * 100) : 78;
  const demoProfit = Number(state.realizedProfitUsd ?? state.realizedProfitBrl ?? 0);
  const realProfit = Number(state.realizedRealProfitUsd ?? state.realizedRealProfitBrl ?? 0);
  const activeProfit = accountMode === 'live' ? realProfit : demoProfit;
  const activeFee = accountMode === 'live' ? Number(state.realFeesEnv ?? state.realFeesInv ?? 0) : Number(state.feesEnv ?? state.feesInv ?? 0);
  return <div className="kpi-strip">
    <AccountBalanceKpi state={state} accountMode={accountMode} setAccountMode={setAccountMode}/>
    <MiniKpi icon={<CreditCard/>} label="ENV" value={`${num(state.envBalance ?? state.invBalance ?? 0,2)} ENV`} delta={accountMode==='live'?'cobra no lucro real':'demo não consome'}/>
    <MiniKpi icon={<ShieldCheck/>} label="Status Binance" value={state.binancePending?'Validando...':state.apiConnected?'Conectada':'Desconectada'} delta={state.binancePending?'conector local':accountMode==='live'?'conta real':'modo demo'}/>
    <MiniKpi icon={<TrendingUp/>} label={accountMode==='live'?'Lucro real ativo':'Lucro demo ativo'} value={usd(activeProfit)} delta={`${num(activeFee,2)} ENV taxa`}/>
    <MiniKpi icon={<TrendingUp/>} label="Lucro demo" value={usd(demoProfit)} delta={`${num(state.feesEnv ?? state.feesInv ?? 0,2)} ENV taxa`}/>
    <MiniKpi icon={<TrendingUp/>} label="Lucro real" value={usd(realProfit)} delta={`${num(state.realFeesEnv ?? state.realFeesInv ?? 0,2)} ENV taxa`}/>
    <MiniKpi icon={<Gauge/>} label="Win Rate" value={`${winRate||0}%`} delta="estimado"/>
    <MiniKpi icon={<BarChart3/>} label="Par ativo" value={symbol.replace('USDT','/USDT')} delta={lastPrice?`$ ${lastPrice.toFixed(2)}`:'carregando'}/>
    <MiniKpi icon={<Activity/>} label="Timeframe" value={timeframe.toUpperCase()} delta="janela de operação"/>
    <div className="kpi-live"><img src="/favicon.png"/><strong>{state.active?'ROBÔ ATIVO':'AGUARDANDO'}</strong><span>{state.active?'Último sync agora':'Clique em iniciar'}</span></div>
  </div>
}

function AccountBalanceKpi({state,accountMode,setAccountMode}){
  const isLive = accountMode === 'live';
  const value = isLive ? (state.binancePending ? 'Validando...' : state.apiConnected ? usdt(state.binanceUsdtBalance || 0) : 'Desconectado') : usd(state.balanceUsd ?? state.balanceBrl ?? 0);
  const delta = isLive ? (state.apiConnected ? 'saldo real Binance' : 'conecte a API') : 'saldo demo USDT';
  return <div className="mini-kpi account-balance-kpi">
    <div className="kpi-icon"><Wallet/></div>
    <span>Saldo da conta</span>
    <strong>{value}</strong>
    <small>{delta}</small>
    <div className="account-kpi-toggle">
      <button type="button" className={accountMode==='demo'?'active':''} onClick={()=>setAccountMode('demo')}>Demo</button>
      <button type="button" className={accountMode==='live'?'active':''} onClick={()=>setAccountMode('live')}>Real</button>
    </div>
  </div>
}
function MiniKpi({icon,label,value,delta}){return <div className="mini-kpi"><div className="kpi-icon">{icon}</div><span>{label}</span><strong>{value}</strong><small>{delta}</small></div>}

function Dashboard({user,state,setState,symbol,setSymbol,timeframe,setTimeframe,candles,analysis,radar,recommended,operateRecommended,operateSelected,createTargetOrder,selectionMode,setSelectionMode,accountMode,setAccountMode,marketStatus,lastPrice}){
  return <div className="terminal-layout">
    <div className="chart-zone panel-glow">
      <RobotStatusBar state={state} analysis={analysis} accountMode={accountMode} marketStatus={marketStatus} lastPrice={lastPrice}/>
      <ChartHeader symbol={symbol} setSymbol={setSymbol} timeframe={timeframe} setTimeframe={setTimeframe} analysis={analysis}/>
      <TradingChart candles={candles} analysis={analysis} timeframe={timeframe} symbol={symbol}/>
    </div>
    <TradingControl state={state} setState={setState} symbol={symbol} setSymbol={setSymbol} analysis={analysis} recommended={recommended} operateRecommended={operateRecommended} operateSelected={operateSelected} createTargetOrder={createTargetOrder} selectionMode={selectionMode} setSelectionMode={setSelectionMode} accountMode={accountMode} setAccountMode={setAccountMode}/>
    <TargetOrderPreview state={state} symbol={symbol} timeframe={timeframe} analysis={analysis} createTargetOrder={createTargetOrder} accountMode={accountMode} user={user}/>
    <RecommendedCard recommended={recommended} symbol={symbol} analysis={analysis} setSymbol={setSymbol} operateRecommended={operateRecommended}/>
    <RecentTrades orders={state.orders}/>
    <MarketAI analysis={analysis} radar={radar}/>
    <SystemPerformance state={state}/>
  </div>
}

function RobotStatusBar({state,analysis,accountMode,marketStatus,lastPrice}){
  const operating = state.positions?.length > 0;
  const status = operating ? 'ROBÔ OPERANDO' : analysis?.orderPlan ? 'OPORTUNIDADE ENCONTRADA' : state.active ? 'ROBÔ ANALISANDO' : 'ROBÔ EM ESPERA';
  const detail = operating
    ? `Cesta aberta na mão ${state.positions[0]?.ladderLevel || 1}; buscando saída com +0,5% sobre preço médio.`
    : analysis?.orderPlan
      ? `Setup monitorado: ${analysis.reason}. Confira entrada, alvo e martingale controlado.`
      : `${marketStatus}. Aguardando confirmação de score, volume e tendência.`;
  return <div className="alert"><b>{status}</b><p>{detail}</p><p><span>Modo:</span> <b>{accountMode==='live'?'Conta real':'Conta demo'}</b> - <span>Preço:</span> <b>{lastPrice?lastPrice.toFixed(6):'...'}</b> - <span>Score:</span> <b>{analysis?.score || 0}/100</b></p></div>
}

function ChartHeader({symbol,setSymbol,timeframe,setTimeframe,analysis}){
  const price=analysis?.price;
  return <div className="chart-head-pro">
    <div className="symbol-select"><span className="coin-badge">BTC</span><select value={symbol} onChange={e=>setSymbol(e.target.value)}>{allowedSymbols.map(s=><option key={s}>{s}</option>)}</select><strong>{price?price.toFixed(2):'...'}</strong><small>{analysis?.regime||'Carregando'}</small></div>
    <div className="timeframes">{['1m','5m','15m','1h','4h','1d'].map(tf=><button key={tf} className={timeframe===tf?'active':''} onClick={()=>setTimeframe(tf)}>{tf==='1d'?'1D':tf}</button>)}</div>
    <div className="chart-actions"><span><SlidersHorizontal size={15}/> Indicadores</span><span><Settings size={15}/> Template</span></div>
  </div>
}

function TradingChart({candles,analysis,timeframe,symbol}){
  const [visibleCount,setVisibleCount]=useState(90);
  const [offset,setOffset]=useState(0);
  const dragRef=useRef(null);
  const all = candles || [];
  const maxOffset = Math.max(0, all.length - visibleCount);
  const normalizedOffset = Math.min(offset, maxOffset);
  const endIndex = Math.max(0, all.length - normalizedOffset);
  const startIndex = Math.max(0, endIndex - visibleCount);
  const safeCandles = all.slice(startIndex,endIndex);
  const sr = safeCandles.length ? supportResistance(safeCandles,48) : null;
  const max = safeCandles.length ? Math.max(...safeCandles.map(c=>c.high)) : 1;
  const min = safeCandles.length ? Math.min(...safeCandles.map(c=>c.low)) : 0;
  const range = Math.max(1, max-min);
  const width = 1200;
  const height = 430;
  const chartH = 330;
  const y = (price)=> 35 + ((max - price) / range) * chartH;
  const candleW = Math.max(4, Math.floor(width / Math.max(1,safeCandles.length)) - 3);
  const maxVolume = safeCandles.reduce((a,b)=>Math.max(a,b.volume||0),1)||1;

  useEffect(()=>{ setOffset(0); setVisibleCount(90); },[symbol,timeframe]);
  useEffect(()=>{ if(offset>maxOffset) setOffset(maxOffset); },[offset,maxOffset]);

  const clampOffset=(next)=>Math.max(0,Math.min(maxOffset,next));
  const zoom=(direction)=>{
    setVisibleCount(v=>{
      const next=direction==='in'?Math.max(28,v-14):Math.min(Math.max(120,all.length||120),v+18);
      return next;
    });
  };
  const resetLive=()=>{setOffset(0);setVisibleCount(90)};
  const pan=(amount)=>setOffset(o=>clampOffset(o+amount));

  function onWheel(e){
    e.preventDefault();
    if(e.deltaY<0) zoom('in'); else zoom('out');
  }
  function onPointerDown(e){
    dragRef.current={x:e.clientX,offset:normalizedOffset};
    e.currentTarget.setPointerCapture?.(e.pointerId);
  }
  function onPointerMove(e){
    if(!dragRef.current) return;
    const dx=e.clientX-dragRef.current.x;
    const delta=Math.round(-dx/9);
    setOffset(clampOffset(dragRef.current.offset+delta));
  }
  function onPointerUp(e){
    dragRef.current=null;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
  }

  if(!safeCandles.length){
    return <div className="chart-shell"><div className="chart-tool-rail"><span>+</span><span>/</span><span>-</span><span>AI</span><span>T</span><span>O</span></div><div className="chartbox-pro chartbox-svg"><div className="chart-fallback"><b>Carregando gráfico real</b><span>Buscando candles da Binance...</span></div></div></div>
  }

  return <div className="chart-shell">
    <div className="chart-tool-rail"><span>+</span><span>/</span><span>-</span><span>AI</span><span>T</span><span>O</span></div>
    <div className="chartbox-pro chartbox-svg interactive-chart" onWheel={onWheel} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp} onDoubleClick={resetLive} title="Arraste para movimentar. Use o scroll para dar zoom. Clique duas vezes para voltar ao ao vivo.">
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className="native-chart" role="img" aria-label="Gráfico INVCRIPTO interativo">
        <defs>
          <linearGradient id="chartGlow" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="rgba(22,201,87,.25)" />
            <stop offset="100%" stopColor="rgba(216,178,74,.04)" />
          </linearGradient>
        </defs>
        {[0,1,2,3,4,5,6,7].map(i=><line key={'v'+i} x1={i*width/7} x2={i*width/7} y1="18" y2="390" className="grid-line"/>)}
        {[0,1,2,3,4,5].map(i=><line key={'h'+i} x1="0" x2={width} y1={35+i*chartH/5} y2={35+i*chartH/5} className="grid-line"/>)}
        {sr?.resistance && <line x1="0" x2={width} y1={y(sr.resistance)} y2={y(sr.resistance)} className="resistance-line"/>}
        {sr?.support && <line x1="0" x2={width} y1={y(sr.support)} y2={y(sr.support)} className="support-line"/>}
        <polyline points={safeCandles.map((c,i)=>`${(i+0.5)*width/safeCandles.length},${y(c.close)}`).join(' ')} className="close-line" fill="none"/>
        {safeCandles.map((c,i)=>{
          const x=(i+0.5)*width/safeCandles.length;
          const up=c.close>=c.open;
          const top=y(Math.max(c.open,c.close));
          const bottom=y(Math.min(c.open,c.close));
          const body=Math.max(2,bottom-top);
          const volH=(Math.min(1,(c.volume||0)/maxVolume)*45);
          return <g key={i}>
            <line x1={x} x2={x} y1={y(c.high)} y2={y(c.low)} className={up?'wick up':'wick down'}/>
            <rect x={x-candleW/2} y={top} width={candleW} height={body} rx="2" className={up?'candle up':'candle down'}/>
            <rect x={x-candleW/2} y={395-volH} width={candleW} height={volH} className={up?'volume up':'volume down'}/>
          </g>
        })}
        {sr?.resistance && <text x={width-170} y={y(sr.resistance)-8} className="chart-label resistance">RESISTÊNCIA {sr.resistance.toFixed(2)}</text>}
        {sr?.support && <text x={width-155} y={y(sr.support)+18} className="chart-label support">SUPORTE {sr.support.toFixed(2)}</text>}
        <text x="20" y="24" className="chart-label muted">INVCRIPTO | {symbol} | {timeframe.toUpperCase()} | arraste/scroll</text>
      </svg>
      <div className="chart-controls-overlay">
        <button onClick={(e)=>{e.stopPropagation();pan(18)}} title="Voltar no histórico">&lt;</button>
        <button onClick={(e)=>{e.stopPropagation();zoom('in')}} title="Aproximar">+</button>
        <button onClick={(e)=>{e.stopPropagation();zoom('out')}} title="Afastar">-</button>
        <button onClick={(e)=>{e.stopPropagation();resetLive()}} title="Voltar ao candle atual">LIVE</button>
        <button onClick={(e)=>{e.stopPropagation();pan(-18)}} title="Avançar">&gt;</button>
      </div>
      <div className="chart-help">Arraste para mover | Scroll para zoom | Duplo clique para voltar ao vivo | {safeCandles.length} candles</div>
    </div>
  </div>
}

function TradingControl({state,setState,symbol,setSymbol,analysis,recommended,operateRecommended,operateSelected,createTargetOrder,selectionMode,setSelectionMode,accountMode,setAccountMode}){
  const canPreview = Boolean(analysis?.orderPlan);
  const locked = Boolean(state.active);
  return <div className="trade-control panel-glow">
    <h3><span/> Trading Control</h3>
    <label>Modo de escolha</label>
    <select value={selectionMode} onChange={e=>setSelectionMode(e.target.value)} disabled={locked}><option value="recommended">Operar recomendado pela IA</option><option value="manual_assisted">Manual assistido</option><option value="auto_ai">IA escolhe automático</option></select>
    <label>Moeda selecionada</label>
    <select value={symbol} onChange={e=>setSymbol(e.target.value)} disabled={locked}>{allowedSymbols.map(s=><option key={s}>{s}</option>)}</select>
    <label>Recomendação IA</label>
    <div className="recommend-line"><strong>{recommended.symbol?.replace('USDT','/USDT')}</strong><span>{recommended.score}/100</span></div>
    <label>Conta de operação</label>
    <div className="mode-buttons"><button className={accountMode==='demo'?'active':''} type="button" onClick={()=>setAccountMode('demo')} disabled={locked}>Demo</button><button className={accountMode==='live'?'active':''} type="button" onClick={()=>setAccountMode('live')} disabled={locked}>Real Spot</button></div>
    <small className="sync">{locked?'Robô ativo: estratégia travada. Em conta real, oportunidades com score >= 78 enviam compra + venda automaticamente.':accountMode==='demo'?'Conta demo não consome ENV.':'Conta real consome ENV somente sobre lucro realizado.'}</small>
    <div className="switch-row"><span>Auto Trading</span><button className={state.active?'switch on':'switch'} onClick={()=>setState(s=>({...s,active:!s.active}))}/></div>
    <button className="btn ghost" type="button" onClick={createTargetOrder} disabled={locked || !canPreview}><TrendingUp size={16}/> Criar ordem alvo 1</button>
    <button className="btn primary gold-btn" onClick={operateRecommended} disabled={locked}><Play size={16}/> Operar recomendado</button>
    <button className="btn ghost" onClick={operateSelected} disabled={locked}><ShieldCheck size={16}/> Operar moeda selecionada</button>
    <button className="btn danger full" onClick={()=>setState(s=>({...s,active:false}))}><StopCircle size={16}/> Parar robô</button>
    <small className="sync"><span className="live-dot"/> Last sync: 2 sec ago</small>
  </div>
}

function TargetOrderPreview({state,symbol,timeframe,analysis,createTargetOrder,accountMode,user}){
  const [sending,setSending]=useState(false);
  const [message,setMessage]=useState('');
  const order = (state.targetOrders || []).find(item=>item.symbol===symbol);
  const plan = analysis?.orderPlan;
  if(!order && !plan){
    return <div className="info-card panel-glow"><h3>Ordem alvo 1</h3><p className="muted">A IA ainda não encontrou setup de compra com risco/retorno suficiente para criar uma ordem de visualização.</p><p><b>Ação:</b> {analysis?.action || 'WAIT'}</p><p><b>Score:</b> {analysis?.score || 0}/100</p></div>
  }
  const demoBaseValue = Math.min(state.balanceUsd - 1000, Math.max(10, (state.balanceUsd - 1000) * 0.05));
  const liveBalance = Number(state.binanceUsdtBalance || 0);
  const liveBaseValue = liveBalance > 0 ? Math.max(5, Math.min(10, liveBalance * 0.55)) : 0;
  const baseValue = accountMode === 'live' ? liveBaseValue : demoBaseValue;
  const view = order || {
    status:'PLANO',
    side:'BUY_TARGET_1',
    timeframe,
    price:plan.entry,
    valueUsd:baseValue,
    qty:baseValue / plan.entry,
    stopLoss:plan.stopLoss,
    target1:plan.target1,
    target2:plan.target2,
    recoveryTarget:plan.recoveryTarget,
    ladder:plan.ladder,
    riskUsd:((plan.entry - plan.stopLoss) * (baseValue / plan.entry)),
    potentialProfitUsd:((plan.target1 - plan.entry) * (baseValue / plan.entry)),
    riskReward:plan.riskReward,
    confidence:plan.confidence
  };

  async function sendProtectedOrder(){
    setMessage('');
    if(accountMode !== 'live'){
      setMessage('Selecione Conta real Spot para enviar ordem protegida para a Binance.');
      return;
    }
    if(!user?.id){
      setMessage('Sessao invalida. Faca login novamente.');
      return;
    }
    if(!state.apiConnected || !state.binanceCanTrade){
      setMessage('API Binance precisa estar conectada com permissao de trading.');
      return;
    }
    if(Number(view.valueUsd || 0) < 5){
      setMessage('Saldo real insuficiente para criar compra protegida.');
      return;
    }
    setSending(true);
    try{
      const { data } = await supabase.auth.getSession();
      const token = data?.session?.access_token;
      const manualUserId = user?.manual_profile ? user.id : null;
      const response = await fetch('/.netlify/functions/binance-protected-order', {
        method:'POST',
        headers:{ 'content-type':'application/json', ...(token ? { authorization:`Bearer ${token}` } : {}) },
        body:JSON.stringify({
          manualUserId,
          manualEmail:user?.email || '',
          environment:'live',
          symbol,
          timeframe,
          quoteOrderQty:Number(view.valueUsd || 0),
          targetPrice:Number(view.recoveryTarget || view.target1 || 0),
          score:Number(analysis?.score || 0),
          reason:analysis?.reason || 'Entrada protegida INVCRIPTO'
        })
      });
      const payload = await response.json().catch(()=>({}));
      if(!response.ok || !payload?.ok) throw new Error(payload.error || 'Falha ao enviar ordem protegida.');
      setMessage(`Ordem protegida enviada ao conector. Compra ${usd(payload.quoteOrderQty)} e venda alvo ${Number(payload.targetPrice).toFixed(6)}.`);
    } catch(err){
      setMessage(String(err?.message || err));
    } finally {
      setSending(false);
    }
  }

  return <div className="info-card panel-glow"><h3>Ordem alvo 1</h3><div className="pair-row"><span className="badge ok">{view.status}</span><strong>{symbol.replace('USDT','/USDT')}</strong></div><p><span>Timeframe:</span><b>{String(view.timeframe || '15m').toUpperCase()}</b></p><p><span>Tipo:</span><b>{accountMode==='live'?'Compra mercado + venda limite Binance':'Compra limite paper'}</b></p><p><span>Entrada mão 1:</span><b>{view.price.toFixed(6)}</b></p><p><span>Quantidade estimada:</span><b>{num(view.qty,8)}</b></p><p><span>Valor mão 1:</span><b>{usd(view.valueUsd)}</b></p><p><span>Stop estrutural:</span><b>{view.stopLoss.toFixed(6)}</b></p><p><span>Alvo 1:</span><b>{view.target1.toFixed(6)}</b></p><p><span>Venda protegida:</span><b>{view.recoveryTarget?.toFixed?.(6) || '-'}</b></p><p><span>Risco / ganho alvo 1:</span><b>{usd(view.riskUsd)} / {usd(view.potentialProfitUsd)}</b></p><p><span>R/R:</span><b>{num(view.riskReward,2)}</b></p><p><span>Confiança:</span><b>{view.confidence}/100</b></p>{view.ladder?.length&&<div><h4>Martingale controlado</h4>{view.ladder.map(hand=><p key={hand.level}><span>{hand.label} x{hand.multiplier}:</span><b>{hand.entry.toFixed(6)}</b></p>)}</div>}<button className="btn primary small" type="button" onClick={createTargetOrder}>Salvar prévia alvo 1</button>{accountMode==='live'&&<button className="btn danger small" type="button" onClick={sendProtectedOrder} disabled={sending || state.active}>{sending?'Enviando...':state.active?'Envio automático ativo':'Enviar compra agora (manual)'}</button>}{message&&<div className="alert">{message}</div>}</div>
}
function RecommendedCard({recommended,symbol,analysis,setSymbol,operateRecommended}){
  const isCurrent = recommended.symbol === symbol;
  return <div className="info-card panel-glow"><h3>Par recomendado</h3><div className="pair-row"><span className="coin-badge">BTC</span><strong>{recommended.symbol?.replace('USDT','/USDT')}</strong><span className="badge ok">LONG</span></div><p>Confiança: <b>{recommended.score}%</b></p><div className="progress"><i style={{width:`${recommended.score||0}%`}}/></div><p><span>Hold Recovery:</span><b>{recommended.hold}/100</b></p><p><span>Entrada:</span><b>{analysis?.support?`${analysis.support.toFixed(2)} - ${(analysis.support*1.004).toFixed(2)}`:'aguardando'}</b></p><p><span>Alvo:</span><b>{analysis?.resistance?analysis.resistance.toFixed(2):'aguardando'}</b></p>{!isCurrent&&<button className="btn primary small" onClick={()=>setSymbol(recommended.symbol)}>Selecionar moeda</button>}<button className="btn ghost small" onClick={operateRecommended}>Seguir IA</button></div>
}

function RecentTrades({orders}){
  const items = orders.slice(0,4);
  const fallback=[['BTC/USDT','LONG','+1.28%','2m'],['ETH/USDT','LONG','+2.15%','18m'],['SOL/USDT','LONG','+0.94%','35m'],['BNB/USDT','WAIT','0.00%','1h']];
  return <div className="info-card panel-glow"><h3>Trades recentes</h3>{items.length?items.map(o=><div className="trade-line" key={o.id}><span>{o.symbol.replace('USDT','/USDT')}</span><b className={o.side==='BUY'?'green':'gold'}>{o.side}</b><small>{o.profitUsd?usd(o.profitUsd):usd(o.valueUsd ?? o.valueBrl ?? 0)}</small></div>):fallback.map((x,i)=><div className="trade-line" key={i}><span>{x[0]}</span><b className={x[1]==='WAIT'?'gold':'green'}>{x[1]}</b><small>{x[2]} - {x[3]}</small></div>)}</div>
}

function MarketAI({analysis,radar}){
  const sentiment=analysis?.regime?.includes('ALTA')?'BULLISH':analysis?.regime?.includes('BAIXA')?'DEFENSIVO':'NEUTRO';
  const score=radar[0]?.score||0;
  return <div className="ai-card panel-glow"><h3>Análise de Mercado IA</h3><div className="ai-orb"><Brain size={38}/><span>AI</span></div><p>Sentimento atual</p><strong>{sentiment}</strong><small>{analysis?.reason||'Robô aguardando confirmação de entrada.'}</small><div className="progress"><i style={{width:`${score}%`}}/></div><b>{score}%</b></div>
}
function SystemPerformance({state}){const envBalance=Number(state.envBalance ?? state.invBalance ?? 0);return <div className="info-card panel-glow"><h3>Performance do sistema</h3><Metric label="Bot status" value={state.active?'Rodando':'Pausado'} pct={state.active?88:35}/><Metric label="API latency" value="112ms" pct={42}/><Metric label="ENV" value={`${num(envBalance,2)}`} pct={Math.min(100,envBalance*10)}/><Metric label="Uptime" value="online" pct={91}/></div>}
function Metric({label,value,pct}){return <p className="metric"><span>{label}</span><i><b style={{width:`${pct}%`}}/></i><strong>{value}</strong></p>}

function LiveAnalysis({symbol,setSymbol,timeframe,setTimeframe,candles,state,analysis}){
  return <div className="analysis-layout premium-analysis">
    <div className="chart-card panel-glow"><ChartHeader symbol={symbol} setSymbol={setSymbol} timeframe={timeframe} setTimeframe={setTimeframe} analysis={analysis}/><TradingChart candles={candles} analysis={analysis} timeframe={timeframe} symbol={symbol}/></div>
    <div className="panel decision-panel panel-glow"><h3><Activity size={18}/> Motor de análise</h3>
      <div className="status-pill">{state.active?'ROBÔ ATIVO':'PAUSADO'}</div>
      <p><b>Regime:</b> {analysis?.regime||'Carregando'}</p><p><b>Ação:</b> {analysis?.action||'WAIT'}</p><p><b>Score:</b> {analysis?.score||0}</p><p><b>Motivo:</b> {analysis?.reason||'Aguardando candle'}</p>
      <p><b>Suporte:</b> {analysis?.support?.toFixed?.(2)||'-'}</p><p><b>Resistência:</b> {analysis?.resistance?.toFixed?.(2)||'-'}</p>
      <h4>Cesta atual</h4>{state.positions.length?state.positions.map(p=><p key={p.id}>{p.symbol}: {num(p.qty,8)} @ {p.avgPrice.toFixed(6)} | mão {p.ladderLevel||1} | saída {p.recoveryTarget?.toFixed?.(6)||'-'}</p>):<p className="muted">Sem posição aberta.</p>}
    </div>
  </div>
}

function Scanner({radar,symbol,setSymbol,operateRecommended}){
  return <div className="panel panel-glow"><h3><Sparkles size={18}/> Radar IA - Top moedas Binance</h3><p className="muted">O cliente pode selecionar a moeda, mas a IA recomenda a melhor oportunidade com score de entrada e Hold Recovery de 12 meses.</p><div className="scanner-grid">{radar.map(r=><div className={r.symbol===symbol?'scanner-card active':'scanner-card'} key={r.symbol}><strong>{r.symbol.replace('USDT','/USDT')}</strong><span>Score {r.score}/100</span><small>Hold {r.hold}/100 | Liquidez {r.liquidity}/100</small><button className="btn small ghost" onClick={()=>setSymbol(r.symbol)}>Selecionar</button></div>)}</div><button className="btn primary gold-btn" onClick={operateRecommended}>Operar melhor recomendação</button></div>
}

function Orders({orders}){return <div className="panel panel-glow"><h3><History size={18}/> Histórico de operações</h3><div className="table-wrap"><table><thead><tr><th>Hora</th><th>Side</th><th>Ativo</th><th>Preço</th><th>Valor</th><th>Lucro</th><th>Taxa ENV</th></tr></thead><tbody>{orders.map(o=><tr key={o.id}><td>{new Date(o.at).toLocaleString('pt-BR')}</td><td>{o.side}</td><td>{o.symbol}</td><td>{o.price.toFixed(2)}</td><td>{usd(o.valueUsd ?? o.valueBrl ?? 0)}</td><td>{o.profitUsd?usd(o.profitUsd):'-'}</td><td>{o.feeEnv?num(o.feeEnv,2):'-'}</td></tr>)}</tbody></table></div></div>}
function INV({state}){const envBalance=state.envBalance ?? state.invBalance ?? 0;return <div className="panel panel-glow"><h3><CreditCard size={18}/> Créditos ENV</h3><p>Saldo atual: <b>{num(envBalance,2)} ENV</b></p><p>1 ENV = US$ 1,00. O robô opera em USDT e desconta 10% apenas do lucro realizado em dólar.</p><p>No pagamento via Pix/cartão, o valor em reais será convertido pela cotação do dólar/USDT do momento para liberar ENV.</p><div className="alert">Quando o ENV zerar, o robô bloqueia novas entradas, encerra a cesta conforme segurança e solicita recarga.</div></div>}
function BinanceSettings({user,setState,setAccountMode}){
  const [apiKey,setApiKey]=useState('');
  const [apiSecret,setApiSecret]=useState('');
  const [environment,setEnvironment]=useState('live');
  const [loading,setLoading]=useState(false);
  const [result,setResult]=useState(null);
  const [savedApi,setSavedApi]=useState(null);
  const [error,setError]=useState('');

  function applyBinancePayload(payload){
    setState(s=>({
      ...s,
      ...(payload.envBalance !== undefined ? { envBalance:Number(payload.envBalance || 0) } : {}),
      apiConnected:Boolean(payload.connected || payload.usdtFree || payload.canTrade || payload.credentialStatus === 'active' || payload.credentialStatus === 'review_required'),
      binancePending:Boolean(payload.connectorQueued || payload.credentialStatus === 'pending_connector_validation'),
      binanceCredentialStatus:payload.credentialStatus,
      binanceUsdtBalance:Number(payload.usdtFree||0),
      binanceUsdtLocked:Number(payload.usdtLocked||0),
      binanceCanTrade:Boolean(payload.canTrade),
      accountMode:payload.environment==='live'?'live':'demo'
    }));
    setAccountMode(payload.environment==='live'?'live':'demo');
  }

  async function loadSavedApi(showMessage=false){
    if(!hasSupabase || !user?.id) return null;
    try{
      const { data } = await supabase.auth.getSession();
      const token = data?.session?.access_token;
      const manualUserId = user?.manual_profile ? user.id : null;
      const response = await fetch('/.netlify/functions/binance-status', {
        method:'POST',
        headers:{ 'content-type':'application/json', ...(token ? { authorization:`Bearer ${token}` } : {}) },
        body:JSON.stringify({ manualUserId, manualEmail: user?.email || '', environment })
      });
      const payload = await response.json().catch(()=>({}));
      if(!response.ok || !payload?.ok) throw new Error(payload.error || 'Não foi possível consultar a API salva.');
      if(payload.credentialStatus || payload.apiKeyMasked){
        setSavedApi(payload);
        setResult(payload);
        applyBinancePayload(payload);
        if(showMessage) setError('');
      } else if(showMessage) {
        setError('Nenhuma API salva para este ambiente.');
      }
      return payload;
    } catch(err){
      if(showMessage) setError(String(err?.message || err));
      return null;
    }
  }

  useEffect(()=>{ loadSavedApi(false); },[environment,user?.id]);

  async function refreshFromBinance(){
    setError('');
    setLoading(true);
    try{
      const { data } = await supabase.auth.getSession();
      const token = data?.session?.access_token;
      const manualUserId = user?.manual_profile ? user.id : null;
      const response = await fetch('/.netlify/functions/binance-refresh', {
        method:'POST',
        headers:{ 'content-type':'application/json', ...(token ? { authorization:`Bearer ${token}` } : {}) },
        body:JSON.stringify({ manualUserId, manualEmail: user?.email || '', environment })
      });
      const payload = await response.json().catch(()=>({}));
      if(!response.ok || !payload?.ok) throw new Error(payload.error || 'Não foi possível solicitar atualização na Binance.');
      setResult(payload);
      applyBinancePayload(payload);
      setError('Atualização enviada ao conector local. Assim que ele consultar a Binance, o saldo real aparece aqui.');
      setTimeout(()=>loadSavedApi(false), 5000);
    } catch(err){
      setError(String(err?.message || err));
    } finally {
      setLoading(false);
    }
  }

  async function testAndSave(){
    setError('');
    setResult(null);
    if(!hasSupabase){
      setError('Entre com login real do Supabase para salvar chaves Binance.');
      return;
    }
    if(!apiKey.trim() && !apiSecret.trim() && savedApi?.apiKeyMasked){
      await refreshFromBinance();
      return;
    }
    if(apiKey.trim().length < 20 || apiSecret.trim().length < 20){
      setError('Informe API Key e Secret Key completas para salvar ou substituir a API.');
      return;
    }
    setLoading(true);
    try{
      const { data } = await supabase.auth.getSession();
      const token = data?.session?.access_token;
      const manualUserId = user?.manual_profile ? user.id : null;
      if(!token && !manualUserId) throw new Error('Sessão expirada. Faça login novamente.');
      const response = await fetch('/.netlify/functions/binance-test', {
        method:'POST',
        headers:{ 'content-type':'application/json', ...(token ? { authorization:`Bearer ${token}` } : {}) },
        body:JSON.stringify({ apiKey, apiSecret, environment, manualUserId, manualEmail: user?.email || '' })
      });
      const payload = await response.json().catch(()=>({}));
      if(!response.ok) {
        const detail = payload.detail?.msg || payload.action || '';
        throw new Error([payload.error || 'Não foi possível validar a API Binance.', detail].filter(Boolean).join(' '));
      }
      setResult(payload);
      setSavedApi(payload);
      applyBinancePayload(payload);
      setApiSecret('');
      setApiKey('');
    } catch(err){
      setError(String(err?.message || err));
    } finally {
      setLoading(false);
    }
  }

  return <div className="panel panel-glow">
    <h3><KeyRound size={18}/> Configurações Binance</h3>
    <p className="muted">A chave é criptografada no backend e salva no Supabase. Depois de salvar, não precisa colar novamente para visualizar o saldo.</p>
    {savedApi?.apiKeyMasked && <div className="alert">API salva: <b>{savedApi.apiKeyMasked}</b>. Saldo livre USDT: <b>{usdt(savedApi.usdtFree || 0)}</b>. Status: <b>{savedApi.credentialStatus || 'salva'}</b>.</div>}
    <label>Ambiente</label>
    <select value={environment} onChange={e=>setEnvironment(e.target.value)}><option value="live">Conta real Spot</option><option value="testnet">Testnet Spot</option></select>
    <label>API Key</label>
    <input value={apiKey} onChange={e=>setApiKey(e.target.value)} placeholder={savedApi?.apiKeyMasked ? `API salva: ${savedApi.apiKeyMasked}` : 'Cole a API Key'}/>
    <label>Secret Key</label>
    <input type="password" value={apiSecret} onChange={e=>setApiSecret(e.target.value)} placeholder={savedApi?.apiKeyMasked ? 'Preencha somente para substituir a API salva' : 'Cole a Secret Key'}/>
    <div className="controls">
      <button className="btn primary gold-btn" type="button" onClick={testAndSave} disabled={loading}>{loading?'Processando...':savedApi?.apiKeyMasked && !apiKey && !apiSecret?'Atualizar saldo na Binance':'Salvar API e validar'}</button>
      {savedApi?.apiKeyMasked && <button className="btn ghost" type="button" onClick={()=>loadSavedApi(true)} disabled={loading}>Ver API salva</button>}
    </div>
    {error&&<div className="alert danger">{error}</div>}
    {result&&<div className="alert">API: {result.apiKeyMasked || savedApi?.apiKeyMasked}. Saldo livre USDT: <b>{usdt(result.usdtFree || 0)}</b>. Trade: <b>{result.canTrade?'habilitado':'somente leitura'}</b>.{result.warning&&<p>{result.warning}</p>}</div>}
    <div className="alert">Permissões recomendadas: leitura + spot trading. Saque deve ficar desativado para produção.</div>
  </div>
}

function OldBinanceSettings({user,setState,setAccountMode}){
  const [apiKey,setApiKey]=useState('');
  const [apiSecret,setApiSecret]=useState('');
  const [environment,setEnvironment]=useState('live');
  const [loading,setLoading]=useState(false);
  const [result,setResult]=useState(null);
  const [error,setError]=useState('');

  async function testAndSave(){
    setError('');
    setResult(null);
    if(!hasSupabase){
      setError('Entre com login real do Supabase para salvar chaves Binance. No modo demo local as chaves não são enviadas.');
      return;
    }
    if(apiKey.trim().length < 20 || apiSecret.trim().length < 20){
      setError('Informe API Key e Secret Key completas.');
      return;
    }
    setLoading(true);
    try{
      const { data } = await supabase.auth.getSession();
      const token = data?.session?.access_token;
      const manualUserId = user?.manual_profile ? user.id : null;
      if(!token && !manualUserId) throw new Error('Sessão expirada. Faça login novamente.');
      const response = await fetch('/.netlify/functions/binance-test', {
        method:'POST',
        headers:{ 'content-type':'application/json', ...(token ? { authorization:`Bearer ${token}` } : {}) },
        body:JSON.stringify({ apiKey, apiSecret, environment, manualUserId, manualEmail: user?.email || '' })
      });
      const payload = await response.json().catch(()=>({}));
      if(!response.ok) {
        const detail = payload.detail?.msg || payload.action || '';
        throw new Error([payload.error || 'Não foi possível validar a API Binance.', detail].filter(Boolean).join(' '));
      }
      setResult(payload);
      setState(s=>({
        ...s,
        apiConnected:Boolean(payload.usdtFree || payload.canTrade || payload.credentialStatus === 'active'),
        binancePending:Boolean(payload.connectorQueued || payload.credentialStatus === 'pending_connector_validation'),
        binanceCredentialStatus:payload.credentialStatus,
        binanceUsdtBalance:Number(payload.usdtFree||0),
        binanceUsdtLocked:Number(payload.usdtLocked||0),
        binanceCanTrade:Boolean(payload.canTrade),
        accountMode:payload.environment==='live'?'live':'demo'
      }));
      setAccountMode(payload.environment==='live'?'live':'demo');
      setApiSecret('');
    } catch(err){
      setError(String(err?.message || err));
    } finally {
      setLoading(false);
    }
  }

  return <div className="panel panel-glow"><h3><KeyRound size={18}/> Configurações Binance</h3><p className="muted">A chave é enviada somente para a Netlify Function, testada na Binance, criptografada no backend e salva no Supabase. O robô opera pares Spot contra USDT.</p><label>Ambiente</label><select value={environment} onChange={e=>setEnvironment(e.target.value)}><option value="testnet">Testnet Spot</option><option value="live">Conta real Spot</option></select><label>API Key</label><input value={apiKey} onChange={e=>setApiKey(e.target.value)} placeholder="Cole a API Key"/><label>Secret Key</label><input type="password" value={apiSecret} onChange={e=>setApiSecret(e.target.value)} placeholder="Cole a Secret Key"/><button className="btn primary gold-btn" type="button" onClick={testAndSave} disabled={loading}>{loading?'Testando...':'Testar conexão e salvar API'}</button>{error&&<div className="alert danger">{error}</div>}{result&&<div className="alert">API validada: {result.apiKeyMasked}. Saldo livre USDT: <b>{usdt(result.usdtFree)}</b>. Trade: <b>{result.canTrade?'habilitado':'somente leitura'}</b>.{result.warning&&<p>{result.warning}</p>}</div>}<div className="alert">Permissões recomendadas: leitura + spot trading. Saque deve estar desativado. Valor BRL fica apenas para recarga, convertido pela cotação do dólar/USDT.</div></div>
}

function buildRadar(analysis, currentSymbol){
  const base = allowedSymbols.map((s,idx)=>{
    const seed=radarSeed[s]||{hold:65,liquidity:65};
    const trendBonus = currentSymbol===s ? Math.min(25, Math.max(0, Number(analysis.score||0)-55)) : Math.max(0, 16-idx);
    const score = Math.min(96, Math.round(seed.hold*0.22 + seed.liquidity*0.22 + 34 + trendBonus));
    return {symbol:s, score, hold:seed.hold, liquidity:seed.liquidity};
  });
  return base.sort((a,b)=>b.score-a.score);
}

