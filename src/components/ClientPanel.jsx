import React, { useEffect, useMemo, useRef, useState } from 'react';
import { initialPaperState, runPaperDecision } from '../lib/paperBot.js';
import { analyzeMarket, supportResistance } from '../lib/strategy.js';
import { brl, usd, usdt, env, num } from '../lib/format.js';
import { Activity, BarChart3, Bot, Brain, CreditCard, Gauge, History, KeyRound, Pause, Play, Settings, ShieldCheck, SlidersHorizontal, Sparkles, StopCircle, TrendingUp, Wallet } from 'lucide-react';

const allowedSymbols = ['BTCUSDT','ETHUSDT','BNBUSDT','SOLUSDT','XRPUSDT','ADAUSDT','AVAXUSDT','DOGEUSDT','LINKUSDT','DOTUSDT','LTCUSDT','TRXUSDT'];
const radarSeed = {
  BTCUSDT:{hold:94,liquidity:96}, ETHUSDT:{hold:91,liquidity:94}, BNBUSDT:{hold:86,liquidity:88}, SOLUSDT:{hold:78,liquidity:90}, XRPUSDT:{hold:74,liquidity:86}, ADAUSDT:{hold:72,liquidity:78}, AVAXUSDT:{hold:70,liquidity:76}, DOGEUSDT:{hold:68,liquidity:82}, LINKUSDT:{hold:76,liquidity:74}, DOTUSDT:{hold:69,liquidity:70}, LTCUSDT:{hold:73,liquidity:72}, TRXUSDT:{hold:71,liquidity:73}
};

export default function ClientPanel({user}){
  const [activeTab,setActiveTab]=useState('dashboard');
  const [symbol,setSymbol]=useState('BTCUSDT');
  const [timeframe,setTimeframe]=useState('15m');
  const [candles,setCandles]=useState([]);
  const [state,setState]=useState(()=>JSON.parse(localStorage.getItem('df_paper_state')||'null') || initialPaperState(Number(import.meta.env.VITE_DEFAULT_PAPER_BALANCE_USD||1000)));
  const [selectionMode,setSelectionMode]=useState('recommended');
  const lastPrice=candles.at(-1)?.close||0;
  const analysis = useMemo(()=>analyzeMarket(candles),[candles]);
  const radar = useMemo(()=>buildRadar(analysis, symbol),[analysis, symbol]);
  const recommended = radar[0] || {symbol:'BTCUSDT',score:0,hold:0};

  useEffect(()=>{localStorage.setItem('df_paper_state',JSON.stringify({...state,symbol}))},[state,symbol]);
  useEffect(()=>{
    let closed=false;
    let ws=null;
    let reloadTimer=null;
    const normalize=(k)=>({
      time:Math.floor(Number(k[0])/1000),
      open:Number(k[1]),
      high:Number(k[2]),
      low:Number(k[3]),
      close:Number(k[4]),
      volume:Number(k[5])
    });
    const upsertLiveCandle=(next)=>{
      setCandles(prev=>{
        if(!prev.length) return [next];
        const copy=[...prev];
        const last=copy[copy.length-1];
        if(last.time===next.time){
          copy[copy.length-1]={...last,...next, high:Math.max(last.high,next.high), low:Math.min(last.low,next.low)};
        }else if(next.time>last.time){
          copy.push(next);
          if(copy.length>520) copy.shift();
        }
        return copy;
      });
    };
    async function loadSnapshot(){
      try{
        const res=await fetch(`/.netlify/functions/binance-klines?symbol=${symbol}&interval=${timeframe}&limit=500&ts=${Date.now()}`, {cache:'no-store'}).catch(()=>null);
        let data=[];
        if(res?.ok) data=await res.json();
        if(!Array.isArray(data) || !data.length){
          const r=await fetch(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${timeframe}&limit=500`, {cache:'no-store'});
          data=await r.json();
        }
        if(!closed && Array.isArray(data)){
          setCandles(data.map(normalize).filter(c=>Number.isFinite(c.close)));
        }
      } catch(e){
        if(!closed) console.warn('Falha ao buscar candles Binance', e);
      }
    }
    function connectStream(){
      try{
        const streamSymbol=symbol.toLowerCase();
        ws=new WebSocket(`wss://stream.binance.com:9443/stream?streams=${streamSymbol}@kline_${timeframe}/${streamSymbol}@ticker/${streamSymbol}@trade`);
        ws.onmessage=(event)=>{
          if(closed) return;
          const payload=JSON.parse(event.data||'{}');
          const data=payload.data||payload;
          if(data.e==='kline' && data.k){
            const k=data.k;
            upsertLiveCandle({
              time:Math.floor(Number(k.t)/1000),
              open:Number(k.o), high:Number(k.h), low:Number(k.l), close:Number(k.c), volume:Number(k.v)
            });
          }
          if((data.e==='trade' || data.e==='24hrTicker') && data.p){
            const livePrice=Number(data.p);
            if(Number.isFinite(livePrice)){
              setCandles(prev=>{
                if(!prev.length) return prev;
                const copy=[...prev];
                const last={...copy[copy.length-1]};
                last.close=livePrice;
                last.high=Math.max(last.high,livePrice);
                last.low=Math.min(last.low,livePrice);
                copy[copy.length-1]=last;
                return copy;
              });
            }
          }
        };
        ws.onerror=()=>console.warn('WebSocket Binance com instabilidade; snapshot REST seguirá como fallback.');
      } catch(e){ console.warn('Falha ao iniciar WebSocket Binance', e); }
    }
    loadSnapshot().then(connectStream);
    reloadTimer=setInterval(loadSnapshot,60000);
    return()=>{closed=true; if(ws) ws.close(); if(reloadTimer) clearInterval(reloadTimer);};
  },[symbol,timeframe]);
  useEffect(()=>{ if(state.active && candles.length){ const t=setInterval(()=>setState(s=>runPaperDecision({...s,symbol},candles)),9000); return()=>clearInterval(t) }},[state.active,candles,symbol]);

  function operateRecommended(){ setSymbol(recommended.symbol); setSelectionMode('recommended'); setState(s=>({...s,active:true,symbol:recommended.symbol})); }
  function operateSelected(){ setSelectionMode('manual_assisted'); setState(s=>({...s,active:true,symbol})); }

  const tabs=[['dashboard','Dashboard'],['analysis','Análise ao vivo'],['scanner','Radar IA'],['orders','Operações'],['inv','Créditos ENV'],['settings','API Binance']];

  return <div className="robot-dashboard">
    <div className="hero-row">
      <div className="brand-title">
        <img src="/favicon.png" alt="INVCRIPTO"/>
        <div><h1>INVCRIPTO IA</h1><p>Crypto Trading Robot — gráfico real, paper trade, radar IA e créditos ENV em dólar.</p></div>
      </div>
      <div className="live-badge"><span className="live-dot"/> {state.active?'LIVE · Bot Active':'PAUSADO'}</div>
    </div>

    <KpiStrip state={state} lastPrice={lastPrice} symbol={symbol}/>

    <div className="tabbar premium-tabs">{tabs.map(([k,l])=><button key={k} className={activeTab===k?'active':''} onClick={()=>setActiveTab(k)}>{l}</button>)}</div>

    {activeTab==='dashboard' && <Dashboard state={state} setState={setState} symbol={symbol} setSymbol={setSymbol} timeframe={timeframe} setTimeframe={setTimeframe} candles={candles} analysis={analysis} radar={radar} recommended={recommended} operateRecommended={operateRecommended} operateSelected={operateSelected} selectionMode={selectionMode} setSelectionMode={setSelectionMode}/>}    
    {activeTab==='analysis' && <LiveAnalysis symbol={symbol} setSymbol={setSymbol} timeframe={timeframe} setTimeframe={setTimeframe} candles={candles} state={state} analysis={analysis}/>}    
    {activeTab==='scanner' && <Scanner radar={radar} symbol={symbol} setSymbol={setSymbol} operateRecommended={operateRecommended}/>}    
    {activeTab==='orders' && <Orders orders={state.orders}/>}    
    {activeTab==='inv' && <INV state={state}/>}    
    {activeTab==='settings' && <BinanceSettings/>}
  </div>
}

function KpiStrip({state,lastPrice,symbol}){
  const winRate = state.orders.length ? Math.round((state.orders.filter(o=>Number(o.profitBrl||0)>0).length / Math.max(1,state.orders.filter(o=>o.side==='SELL').length))*100) : 78;
  return <div className="kpi-strip">
    <MiniKpi icon={<Wallet/>} label="Saldo Paper" value={usd(state.balanceUsd ?? state.balanceBrl ?? 0)} delta="Simulação USDT"/>
    <MiniKpi icon={<TrendingUp/>} label="Lucro total" value={usd(state.realizedProfitUsd ?? state.realizedProfitBrl ?? 0)} delta={`${num(state.feesEnv ?? state.feesInv ?? 0,2)} ENV taxa`}/>
    <MiniKpi icon={<Gauge/>} label="Win Rate" value={`${winRate||0}%`} delta="estimado"/>
    <MiniKpi icon={<BarChart3/>} label="Par ativo" value={symbol.replace('USDT','/USDT')} delta={lastPrice?`$ ${lastPrice.toFixed(2)}`:'carregando'}/>
    <div className="kpi-live"><img src="/favicon.png"/><strong>{state.active?'ROBÔ ATIVO':'AGUARDANDO'}</strong><span>{state.active?'Último sync agora':'Clique em iniciar'}</span></div>
  </div>
}
function MiniKpi({icon,label,value,delta}){return <div className="mini-kpi"><div className="kpi-icon">{icon}</div><span>{label}</span><strong>{value}</strong><small>{delta}</small></div>}

function Dashboard({state,setState,symbol,setSymbol,timeframe,setTimeframe,candles,analysis,radar,recommended,operateRecommended,operateSelected,selectionMode,setSelectionMode}){
  return <div className="terminal-layout">
    <div className="chart-zone panel-glow">
      <ChartHeader symbol={symbol} setSymbol={setSymbol} timeframe={timeframe} setTimeframe={setTimeframe} analysis={analysis}/>
      <TradingChart candles={candles} analysis={analysis} timeframe={timeframe} symbol={symbol}/>
    </div>
    <TradingControl state={state} setState={setState} symbol={symbol} setSymbol={setSymbol} recommended={recommended} operateRecommended={operateRecommended} operateSelected={operateSelected} selectionMode={selectionMode} setSelectionMode={setSelectionMode}/>
    <RecommendedCard recommended={recommended} symbol={symbol} analysis={analysis} setSymbol={setSymbol} operateRecommended={operateRecommended}/>
    <RecentTrades orders={state.orders}/>
    <MarketAI analysis={analysis} radar={radar}/>
    <SystemPerformance state={state}/>
  </div>
}

function ChartHeader({symbol,setSymbol,timeframe,setTimeframe,analysis}){
  const price=analysis?.price;
  return <div className="chart-head-pro">
    <div className="symbol-select"><span className="coin-badge">₿</span><select value={symbol} onChange={e=>setSymbol(e.target.value)}>{allowedSymbols.map(s=><option key={s}>{s}</option>)}</select><strong>{price?price.toFixed(2):'...'}</strong><small>{analysis?.regime||'Carregando'}</small></div>
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
    return <div className="chart-shell"><div className="chart-tool-rail"><span>⌁</span><span>╱</span><span>⌬</span><span>AI</span><span>T</span><span>◎</span></div><div className="chartbox-pro chartbox-svg"><div className="chart-fallback"><b>Carregando gráfico real</b><span>Buscando candles da Binance...</span></div></div></div>
  }

  return <div className="chart-shell">
    <div className="chart-tool-rail"><span>⌁</span><span>╱</span><span>⌬</span><span>AI</span><span>T</span><span>◎</span></div>
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
        <text x="20" y="24" className="chart-label muted">INVCRIPTO · {symbol} · {timeframe.toUpperCase()} · arraste/scroll</text>
      </svg>
      <div className="chart-controls-overlay">
        <button onClick={(e)=>{e.stopPropagation();pan(18)}} title="Voltar no histórico">‹</button>
        <button onClick={(e)=>{e.stopPropagation();zoom('in')}} title="Aproximar">＋</button>
        <button onClick={(e)=>{e.stopPropagation();zoom('out')}} title="Afastar">－</button>
        <button onClick={(e)=>{e.stopPropagation();resetLive()}} title="Voltar ao candle atual">LIVE</button>
        <button onClick={(e)=>{e.stopPropagation();pan(-18)}} title="Avançar">›</button>
      </div>
      <div className="chart-help">Arraste para mover · Scroll para zoom · Duplo clique para voltar ao vivo · {safeCandles.length} candles</div>
    </div>
  </div>
}

function TradingControl({state,setState,symbol,setSymbol,recommended,operateRecommended,operateSelected,selectionMode,setSelectionMode}){
  return <div className="trade-control panel-glow">
    <h3><span/> Trading Control</h3>
    <label>Modo de escolha</label>
    <select value={selectionMode} onChange={e=>setSelectionMode(e.target.value)}><option value="recommended">Operar recomendado pela IA</option><option value="manual_assisted">Manual assistido</option><option value="auto_ai">IA escolhe automático</option></select>
    <label>Moeda selecionada</label>
    <select value={symbol} onChange={e=>setSymbol(e.target.value)}>{allowedSymbols.map(s=><option key={s}>{s}</option>)}</select>
    <label>Recomendação IA</label>
    <div className="recommend-line"><strong>{recommended.symbol?.replace('USDT','/USDT')}</strong><span>{recommended.score}/100</span></div>
    <div className="mode-buttons"><button className="active">Spot</button><button>Paper</button></div>
    <div className="switch-row"><span>Auto Trading</span><button className={state.active?'switch on':'switch'} onClick={()=>setState(s=>({...s,active:!s.active}))}/></div>
    <button className="btn primary gold-btn" onClick={operateRecommended}><Play size={16}/> Operar recomendado</button>
    <button className="btn ghost" onClick={operateSelected}><ShieldCheck size={16}/> Operar moeda selecionada</button>
    <button className="btn danger full" onClick={()=>setState(s=>({...s,active:false}))}><StopCircle size={16}/> Parar robô</button>
    <small className="sync"><span className="live-dot"/> Last sync: 2 sec ago</small>
  </div>
}

function RecommendedCard({recommended,symbol,analysis,setSymbol,operateRecommended}){
  const isCurrent = recommended.symbol === symbol;
  return <div className="info-card panel-glow"><h3>Recommended Pair</h3><div className="pair-row"><span className="coin-badge">₿</span><strong>{recommended.symbol?.replace('USDT','/USDT')}</strong><span className="badge ok">LONG</span></div><p>Confiança: <b>{recommended.score}%</b></p><div className="progress"><i style={{width:`${recommended.score||0}%`}}/></div><p><span>Hold Recovery:</span><b>{recommended.hold}/100</b></p><p><span>Entrada:</span><b>{analysis?.support?`${analysis.support.toFixed(2)} – ${(analysis.support*1.004).toFixed(2)}`:'aguardando'}</b></p><p><span>Alvo:</span><b>{analysis?.resistance?analysis.resistance.toFixed(2):'aguardando'}</b></p>{!isCurrent&&<button className="btn primary small" onClick={()=>setSymbol(recommended.symbol)}>Selecionar moeda</button>}<button className="btn ghost small" onClick={operateRecommended}>Seguir IA</button></div>
}

function RecentTrades({orders}){
  const items = orders.slice(0,4);
  const fallback=[['BTC/USDT','LONG','+1.28%','2m'],['ETH/USDT','LONG','+2.15%','18m'],['SOL/USDT','LONG','+0.94%','35m'],['BNB/USDT','WAIT','0.00%','1h']];
  return <div className="info-card panel-glow"><h3>Recent Trades</h3>{items.length?items.map(o=><div className="trade-line" key={o.id}><span>{o.symbol.replace('USDT','/USDT')}</span><b className={o.side==='BUY'?'green':'gold'}>{o.side}</b><small>{o.profitUsd?usd(o.profitUsd):usd(o.valueUsd ?? o.valueBrl ?? 0)}</small></div>):fallback.map((x,i)=><div className="trade-line" key={i}><span>{x[0]}</span><b className={x[1]==='WAIT'?'gold':'green'}>{x[1]}</b><small>{x[2]} · {x[3]}</small></div>)}</div>
}

function MarketAI({analysis,radar}){
  const sentiment=analysis?.regime?.includes('ALTA')?'BULLISH':analysis?.regime?.includes('BAIXA')?'DEFENSIVO':'NEUTRO';
  const score=radar[0]?.score||0;
  return <div className="ai-card panel-glow"><h3>AI Market Analysis</h3><div className="ai-orb"><Brain size={38}/><span>AI</span></div><p>Sentimento atual</p><strong>{sentiment}</strong><small>{analysis?.reason||'Robô aguardando confirmação de entrada.'}</small><div className="progress"><i style={{width:`${score}%`}}/></div><b>{score}%</b></div>
}
function SystemPerformance({state}){return <div className="info-card panel-glow"><h3>System Performance</h3><Metric label="Bot status" value={state.active?'Running':'Paused'} pct={state.active?88:35}/><Metric label="API latency" value="112ms" pct={42}/><Metric label="ENV" value={`${num(state.envBalance ?? state.invBalance ?? 0,2)}`} pct={Math.min(100,(state.envBalance ?? state.invBalance ?? 0)*10)}/><Metric label="Uptime" value="online" pct={91}/></div>}
function Metric({label,value,pct}){return <p className="metric"><span>{label}</span><i><b style={{width:`${pct}%`}}/></i><strong>{value}</strong></p>}

function LiveAnalysis({symbol,setSymbol,timeframe,setTimeframe,candles,state,analysis}){
  return <div className="analysis-layout premium-analysis">
    <div className="chart-card panel-glow"><ChartHeader symbol={symbol} setSymbol={setSymbol} timeframe={timeframe} setTimeframe={setTimeframe} analysis={analysis}/><TradingChart candles={candles} analysis={analysis} timeframe={timeframe} symbol={symbol}/></div>
    <div className="panel decision-panel panel-glow"><h3><Activity size={18}/> Motor de análise</h3>
      <div className="status-pill">{state.active?'🟢 ROBÔ ATIVO':'⚪ PAUSADO'}</div>
      <p><b>Regime:</b> {analysis?.regime||'Carregando'}</p><p><b>Ação:</b> {analysis?.action||'WAIT'}</p><p><b>Score:</b> {analysis?.score||0}</p><p><b>Motivo:</b> {analysis?.reason||'Aguardando candle'}</p>
      <p><b>Suporte:</b> {analysis?.support?.toFixed?.(2)||'-'}</p><p><b>Resistência:</b> {analysis?.resistance?.toFixed?.(2)||'-'}</p>
      <h4>Cesta atual</h4>{state.positions.length?state.positions.map(p=><p key={p.id}>{p.symbol}: {num(p.qty,8)} @ {p.avgPrice.toFixed(2)}</p>):<p className="muted">Sem posição aberta.</p>}
    </div>
  </div>
}

function Scanner({radar,symbol,setSymbol,operateRecommended}){
  return <div className="panel panel-glow"><h3><Sparkles size={18}/> Radar IA — Top moedas Binance</h3><p className="muted">O cliente pode selecionar a moeda, mas a IA recomenda a melhor oportunidade com score de entrada e Hold Recovery de 12 meses.</p><div className="scanner-grid">{radar.map(r=><div className={r.symbol===symbol?'scanner-card active':'scanner-card'} key={r.symbol}><strong>{r.symbol.replace('USDT','/USDT')}</strong><span>Score {r.score}/100</span><small>Hold {r.hold}/100 · Liquidez {r.liquidity}/100</small><button className="btn small ghost" onClick={()=>setSymbol(r.symbol)}>Selecionar</button></div>)}</div><button className="btn primary gold-btn" onClick={operateRecommended}>Operar melhor recomendação</button></div>
}

function Orders({orders}){return <div className="panel panel-glow"><h3><History size={18}/> Histórico de operações</h3><div className="table-wrap"><table><thead><tr><th>Hora</th><th>Side</th><th>Ativo</th><th>Preço</th><th>Valor</th><th>Lucro</th><th>Taxa ENV</th></tr></thead><tbody>{orders.map(o=><tr key={o.id}><td>{new Date(o.at).toLocaleString('pt-BR')}</td><td>{o.side}</td><td>{o.symbol}</td><td>{o.price.toFixed(2)}</td><td>{usd(o.valueUsd ?? o.valueBrl ?? 0)}</td><td>{o.profitUsd?usd(o.profitUsd):'-'}</td><td>{o.feeEnv?num(o.feeEnv,2):'-'}</td></tr>)}</tbody></table></div></div>}
function INV({state}){const envBalance=state.envBalance ?? state.invBalance ?? 0;return <div className="panel panel-glow"><h3><CreditCard size={18}/> Créditos ENV</h3><p>Saldo atual: <b>{num(envBalance,2)} ENV</b></p><p>1 ENV = US$ 1,00. O robô opera em USDT e desconta 10% apenas do lucro realizado em dólar.</p><p>No pagamento via Pix/cartão, o valor em reais será convertido pela cotação do dólar/USDT do momento para liberar ENV.</p><div className="alert">Quando o ENV zerar, o robô bloqueia novas entradas, encerra a cesta conforme segurança e solicita recarga.</div></div>}
function BinanceSettings(){return <div className="panel panel-glow"><h3><KeyRound size={18}/> Configurações Binance</h3><p className="muted">Ao conectar a API, o backend deve consultar o saldo USDT disponível. O robô opera somente pares contra USDT.</p><label>API Key</label><input placeholder="Cole a API Key"/><label>Secret Key</label><input type="password" placeholder="Cole a Secret Key"/><button className="btn primary gold-btn">Testar conexão e puxar saldo USDT</button><div className="alert">Permissões recomendadas: leitura + spot trading. Saque deve estar desativado. Valor BRL fica apenas para recarga, convertido pela cotação do dólar/USDT.</div></div>}

function buildRadar(analysis, currentSymbol){
  const base = allowedSymbols.map((s,idx)=>{
    const seed=radarSeed[s]||{hold:65,liquidity:65};
    const trendBonus = currentSymbol===s ? Math.min(25, Math.max(0, Number(analysis.score||0)-55)) : Math.max(0, 16-idx);
    const score = Math.min(96, Math.round(seed.hold*0.22 + seed.liquidity*0.22 + 34 + trendBonus));
    return {symbol:s, score, hold:seed.hold, liquidity:seed.liquidity};
  });
  return base.sort((a,b)=>b.score-a.score);
}
