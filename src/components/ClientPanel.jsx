import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createChart } from 'lightweight-charts';
import { initialPaperState, runPaperDecision } from '../lib/paperBot.js';
import { analyzeMarket, supportResistance } from '../lib/strategy.js';
import { brl, num } from '../lib/format.js';
import { Activity, BarChart3, Bot, Brain, CreditCard, Gauge, History, KeyRound, Pause, Play, Settings, ShieldCheck, SlidersHorizontal, Sparkles, StopCircle, TrendingUp, Wallet } from 'lucide-react';

const allowedSymbols = ['BTCUSDT','ETHUSDT','BNBUSDT','SOLUSDT','XRPUSDT','ADAUSDT','AVAXUSDT','DOGEUSDT','LINKUSDT','DOTUSDT','LTCUSDT','TRXUSDT'];
const radarSeed = {
  BTCUSDT:{hold:94,liquidity:96}, ETHUSDT:{hold:91,liquidity:94}, BNBUSDT:{hold:86,liquidity:88}, SOLUSDT:{hold:78,liquidity:90}, XRPUSDT:{hold:74,liquidity:86}, ADAUSDT:{hold:72,liquidity:78}, AVAXUSDT:{hold:70,liquidity:76}, DOGEUSDT:{hold:68,liquidity:82}, LINKUSDT:{hold:76,liquidity:74}, DOTUSDT:{hold:69,liquidity:70}, LTCUSDT:{hold:73,liquidity:72}, TRXUSDT:{hold:71,liquidity:73}
};

export default function ClientPanel({user}){
  const [activeTab,setActiveTab]=useState('dashboard');
  const [symbol,setSymbol]=useState('BTCUSDT');
  const [candles,setCandles]=useState([]);
  const [state,setState]=useState(()=>JSON.parse(localStorage.getItem('df_paper_state')||'null') || initialPaperState(Number(import.meta.env.VITE_DEFAULT_PAPER_BALANCE_BRL||1000)));
  const [selectionMode,setSelectionMode]=useState('recommended');
  const lastPrice=candles.at(-1)?.close||0;
  const analysis = useMemo(()=>analyzeMarket(candles),[candles]);
  const radar = useMemo(()=>buildRadar(analysis, symbol),[analysis, symbol]);
  const recommended = radar[0] || {symbol:'BTCUSDT',score:0,hold:0};

  useEffect(()=>{localStorage.setItem('df_paper_state',JSON.stringify({...state,symbol}))},[state,symbol]);
  useEffect(()=>{
    let closed=false;
    async function load(){
      try{
        const res=await fetch(`/.netlify/functions/binance-klines?symbol=${symbol}&interval=1m&limit=260`).catch(()=>null);
        let data=[];
        if(res?.ok) data=await res.json();
        if(!data.length){
          const r=await fetch(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=1m&limit=260`);
          data=await r.json();
        }
        if(!closed) setCandles(data.map(k=>({time:Math.floor(k[0]/1000),open:+k[1],high:+k[2],low:+k[3],close:+k[4],volume:+k[5]})));
      } catch(e){ if(!closed) setCandles([]); }
    }
    load(); const t=setInterval(load,12000); return()=>{closed=true;clearInterval(t)};
  },[symbol]);
  useEffect(()=>{ if(state.active && candles.length){ const t=setInterval(()=>setState(s=>runPaperDecision({...s,symbol},candles)),9000); return()=>clearInterval(t) }},[state.active,candles,symbol]);

  function operateRecommended(){ setSymbol(recommended.symbol); setSelectionMode('recommended'); setState(s=>({...s,active:true,symbol:recommended.symbol})); }
  function operateSelected(){ setSelectionMode('manual_assisted'); setState(s=>({...s,active:true,symbol})); }

  const tabs=[['dashboard','Dashboard'],['analysis','Análise ao vivo'],['scanner','Radar IA'],['orders','Operações'],['inv','Créditos INV'],['settings','API Binance']];

  return <div className="robot-dashboard">
    <div className="hero-row">
      <div className="brand-title">
        <img src="/favicon.png" alt="INVCRIPTO"/>
        <div><h1>INVCRIPTO IA</h1><p>Crypto Trading Robot — gráfico real, paper trade, radar IA e créditos INV.</p></div>
      </div>
      <div className="live-badge"><span className="live-dot"/> {state.active?'LIVE · Bot Active':'PAUSADO'}</div>
    </div>

    <KpiStrip state={state} lastPrice={lastPrice} symbol={symbol}/>

    <div className="tabbar premium-tabs">{tabs.map(([k,l])=><button key={k} className={activeTab===k?'active':''} onClick={()=>setActiveTab(k)}>{l}</button>)}</div>

    {activeTab==='dashboard' && <Dashboard state={state} setState={setState} symbol={symbol} setSymbol={setSymbol} candles={candles} analysis={analysis} radar={radar} recommended={recommended} operateRecommended={operateRecommended} operateSelected={operateSelected} selectionMode={selectionMode} setSelectionMode={setSelectionMode}/>}    
    {activeTab==='analysis' && <LiveAnalysis symbol={symbol} setSymbol={setSymbol} candles={candles} state={state} analysis={analysis}/>}    
    {activeTab==='scanner' && <Scanner radar={radar} symbol={symbol} setSymbol={setSymbol} operateRecommended={operateRecommended}/>}    
    {activeTab==='orders' && <Orders orders={state.orders}/>}    
    {activeTab==='inv' && <INV state={state}/>}    
    {activeTab==='settings' && <BinanceSettings/>}
  </div>
}

function KpiStrip({state,lastPrice,symbol}){
  const winRate = state.orders.length ? Math.round((state.orders.filter(o=>Number(o.profitBrl||0)>0).length / Math.max(1,state.orders.filter(o=>o.side==='SELL').length))*100) : 78;
  return <div className="kpi-strip">
    <MiniKpi icon={<Wallet/>} label="Saldo Paper" value={brl(state.balanceBrl||0)} delta="Simulação"/>
    <MiniKpi icon={<TrendingUp/>} label="Lucro total" value={brl(state.realizedProfitBrl||0)} delta={`${num(state.feesInv||0,2)} INV taxa`}/>
    <MiniKpi icon={<Gauge/>} label="Win Rate" value={`${winRate||0}%`} delta="estimado"/>
    <MiniKpi icon={<BarChart3/>} label="Par ativo" value={symbol.replace('USDT','/USDT')} delta={lastPrice?`$ ${lastPrice.toFixed(2)}`:'carregando'}/>
    <div className="kpi-live"><img src="/favicon.png"/><strong>{state.active?'ROBÔ ATIVO':'AGUARDANDO'}</strong><span>{state.active?'Último sync agora':'Clique em iniciar'}</span></div>
  </div>
}
function MiniKpi({icon,label,value,delta}){return <div className="mini-kpi"><div className="kpi-icon">{icon}</div><span>{label}</span><strong>{value}</strong><small>{delta}</small></div>}

function Dashboard({state,setState,symbol,setSymbol,candles,analysis,radar,recommended,operateRecommended,operateSelected,selectionMode,setSelectionMode}){
  return <div className="terminal-layout">
    <div className="chart-zone panel-glow">
      <ChartHeader symbol={symbol} setSymbol={setSymbol} analysis={analysis}/>
      <TradingChart candles={candles} analysis={analysis}/>
    </div>
    <TradingControl state={state} setState={setState} symbol={symbol} setSymbol={setSymbol} recommended={recommended} operateRecommended={operateRecommended} operateSelected={operateSelected} selectionMode={selectionMode} setSelectionMode={setSelectionMode}/>
    <RecommendedCard recommended={recommended} symbol={symbol} analysis={analysis} setSymbol={setSymbol} operateRecommended={operateRecommended}/>
    <RecentTrades orders={state.orders}/>
    <MarketAI analysis={analysis} radar={radar}/>
    <SystemPerformance state={state}/>
  </div>
}

function ChartHeader({symbol,setSymbol,analysis}){
  const price=analysis?.price;
  return <div className="chart-head-pro">
    <div className="symbol-select"><span className="coin-badge">₿</span><select value={symbol} onChange={e=>setSymbol(e.target.value)}>{allowedSymbols.map(s=><option key={s}>{s}</option>)}</select><strong>{price?price.toFixed(2):'...'}</strong><small>{analysis?.regime||'Carregando'}</small></div>
    <div className="timeframes"><button>1m</button><button>5m</button><button className="active">15m</button><button>1h</button><button>4h</button><button>1D</button></div>
    <div className="chart-actions"><span><SlidersHorizontal size={15}/> Indicadores</span><span><Settings size={15}/> Template</span></div>
  </div>
}

function TradingChart({candles,analysis}){
  const ref=useRef(null);
  useEffect(()=>{
    if(!ref.current || !candles.length) return;
    let chart = null;
    try{
      const el=ref.current;
      el.innerHTML='';
      chart=createChart(el,{height:430,layout:{background:{color:'#06160f'},textColor:'#f5ebc8'},grid:{vertLines:{color:'rgba(216,178,74,.11)'},horzLines:{color:'rgba(216,178,74,.11)'}},rightPriceScale:{borderColor:'rgba(216,178,74,.35)'},timeScale:{borderColor:'rgba(216,178,74,.35)'},crosshair:{mode:1}});
      const candleSeries=chart.addCandlestickSeries({upColor:'#16c957',downColor:'#d8b24a',borderUpColor:'#16c957',borderDownColor:'#d8b24a',wickUpColor:'#16c957',wickDownColor:'#d8b24a'});
      candleSeries.setData(candles);
      const sr = candles.length? supportResistance(candles,48) : null;
      if(sr?.support && sr?.resistance){
        const startTime=candles[0].time, endTime=candles[candles.length-1].time;
        const support=chart.addLineSeries({color:'#d8b24a',lineWidth:2,lineStyle:0,priceLineVisible:true,title:'SUPORTE'});
        support.setData([{time:startTime,value:sr.support},{time:endTime,value:sr.support}]);
        const resistance=chart.addLineSeries({color:'#16c957',lineWidth:2,lineStyle:0,priceLineVisible:true,title:'RESISTÊNCIA'});
        resistance.setData([{time:startTime,value:sr.resistance},{time:endTime,value:sr.resistance}]);
        if(analysis?.ema21){
          const ema=chart.addLineSeries({color:'#8a6a22',lineWidth:1,priceLineVisible:false,title:'EMA 21'});
          ema.setData(candles.slice(-100).map(c=>({time:c.time,value:analysis.ema21})));
        }
      }
      chart.timeScale().fitContent();
    } catch(err){
      console.error('Erro ao carregar gráfico INVCRIPTO:', err);
      if(ref.current){
        ref.current.innerHTML='<div class="chart-fallback"><b>Gráfico em modo seguro</b><span>O painel continua ativo. Recarregue a página se o gráfico não aparecer.</span></div>';
      }
    }
    return()=>{ if(chart) chart.remove(); };
  },[candles,analysis?.support,analysis?.resistance]);
  return <div className="chart-shell"><div className="chart-tool-rail"><span>⌁</span><span>╱</span><span>⌬</span><span>AI</span><span>T</span><span>◎</span></div><div ref={ref} className="chartbox-pro">{!candles.length && <div className="chart-fallback"><b>Carregando gráfico real</b><span>Buscando candles da Binance...</span></div>}</div></div>
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
  return <div className="info-card panel-glow"><h3>Recent Trades</h3>{items.length?items.map(o=><div className="trade-line" key={o.id}><span>{o.symbol.replace('USDT','/USDT')}</span><b className={o.side==='BUY'?'green':'gold'}>{o.side}</b><small>{o.profitBrl?brl(o.profitBrl):brl(o.valueBrl||0)}</small></div>):fallback.map((x,i)=><div className="trade-line" key={i}><span>{x[0]}</span><b className={x[1]==='WAIT'?'gold':'green'}>{x[1]}</b><small>{x[2]} · {x[3]}</small></div>)}</div>
}

function MarketAI({analysis,radar}){
  const sentiment=analysis?.regime?.includes('ALTA')?'BULLISH':analysis?.regime?.includes('BAIXA')?'DEFENSIVO':'NEUTRO';
  const score=radar[0]?.score||0;
  return <div className="ai-card panel-glow"><h3>AI Market Analysis</h3><div className="ai-orb"><Brain size={38}/><span>AI</span></div><p>Sentimento atual</p><strong>{sentiment}</strong><small>{analysis?.reason||'Robô aguardando confirmação de entrada.'}</small><div className="progress"><i style={{width:`${score}%`}}/></div><b>{score}%</b></div>
}
function SystemPerformance({state}){return <div className="info-card panel-glow"><h3>System Performance</h3><Metric label="Bot status" value={state.active?'Running':'Paused'} pct={state.active?88:35}/><Metric label="API latency" value="112ms" pct={42}/><Metric label="INV" value={`${num(state.invBalance,2)}`} pct={Math.min(100,state.invBalance*10)}/><Metric label="Uptime" value="online" pct={91}/></div>}
function Metric({label,value,pct}){return <p className="metric"><span>{label}</span><i><b style={{width:`${pct}%`}}/></i><strong>{value}</strong></p>}

function LiveAnalysis({symbol,setSymbol,candles,state,analysis}){
  return <div className="analysis-layout premium-analysis">
    <div className="chart-card panel-glow"><ChartHeader symbol={symbol} setSymbol={setSymbol} analysis={analysis}/><TradingChart candles={candles} analysis={analysis}/></div>
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

function Orders({orders}){return <div className="panel panel-glow"><h3><History size={18}/> Histórico de operações</h3><div className="table-wrap"><table><thead><tr><th>Hora</th><th>Side</th><th>Ativo</th><th>Preço</th><th>Valor</th><th>Lucro</th><th>Taxa INV</th></tr></thead><tbody>{orders.map(o=><tr key={o.id}><td>{new Date(o.at).toLocaleString('pt-BR')}</td><td>{o.side}</td><td>{o.symbol}</td><td>{o.price.toFixed(2)}</td><td>{brl(o.valueBrl||0)}</td><td>{o.profitBrl?brl(o.profitBrl):'-'}</td><td>{o.feeInv?num(o.feeInv,2):'-'}</td></tr>)}</tbody></table></div></div>}
function INV({state}){return <div className="panel panel-glow"><h3><CreditCard size={18}/> Créditos INV</h3><p>Saldo atual: <b>{num(state.invBalance,2)} INV</b></p><p>1 INV = R$ 1,00. No modo real, o sistema descontará 10% do lucro realizado. No modo paper, a taxa é apenas simulada.</p><div className="alert">Quando o INV zerar, o robô pausa e solicita recarga.</div></div>}
function BinanceSettings(){return <div className="panel panel-glow"><h3><KeyRound size={18}/> Configurações Binance</h3><p className="muted">MVP visual. As credenciais reais devem ser criptografadas no backend. Nunca peça permissão de saque.</p><label>API Key</label><input placeholder="Cole a API Key"/><label>Secret Key</label><input type="password" placeholder="Cole a Secret Key"/><button className="btn primary gold-btn">Testar conexão</button><div className="alert">Permissões recomendadas: leitura + spot trading. Saque deve estar desativado.</div></div>}

function buildRadar(analysis, currentSymbol){
  const base = allowedSymbols.map((s,idx)=>{
    const seed=radarSeed[s]||{hold:65,liquidity:65};
    const trendBonus = currentSymbol===s ? Math.min(25, Math.max(0, Number(analysis.score||0)-55)) : Math.max(0, 16-idx);
    const score = Math.min(96, Math.round(seed.hold*0.22 + seed.liquidity*0.22 + 34 + trendBonus));
    return {symbol:s, score, hold:seed.hold, liquidity:seed.liquidity};
  });
  return base.sort((a,b)=>b.score-a.score);
}
