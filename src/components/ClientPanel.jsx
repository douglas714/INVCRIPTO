import React, { useEffect, useMemo, useState } from 'react';
import { createChart } from 'lightweight-charts';
import { initialPaperState, runPaperDecision } from '../lib/paperBot.js';
import { brl, num } from '../lib/format.js';
import { Activity, Bot, CreditCard, KeyRound, Play, Pause, Settings } from 'lucide-react';

const symbols=['BTCUSDT','ETHUSDT'];

export default function ClientPanel({user}){
  const [activeTab,setActiveTab]=useState('dashboard');
  const [symbol,setSymbol]=useState('BTCUSDT');
  const [candles,setCandles]=useState([]);
  const [state,setState]=useState(()=>JSON.parse(localStorage.getItem('df_paper_state')||'null') || initialPaperState(Number(import.meta.env.VITE_DEFAULT_PAPER_BALANCE_BRL||1000)));
  const lastPrice=candles.at(-1)?.close||0;
  useEffect(()=>{localStorage.setItem('df_paper_state',JSON.stringify({...state,symbol}))},[state,symbol]);
  useEffect(()=>{
    let closed=false;
    async function load(){
      const res=await fetch(`/.netlify/functions/binance-klines?symbol=${symbol}&interval=1m&limit=200`).catch(()=>null);
      let data=[];
      if(res?.ok) data=await res.json();
      if(!data.length){
        const r=await fetch(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=1m&limit=200`); data=await r.json();
      }
      if(!closed) setCandles(data.map(k=>({time:Math.floor(k[0]/1000),open:+k[1],high:+k[2],low:+k[3],close:+k[4]})));
    }
    load(); const t=setInterval(load,15000); return()=>{closed=true;clearInterval(t)}
  },[symbol]);
  useEffect(()=>{ if(state.active && candles.length){ const t=setInterval(()=>setState(s=>runPaperDecision({...s,symbol},candles)),10000); return()=>clearInterval(t) }},[state.active,candles,symbol]);
  const tabs=[['dashboard','Dashboard'],['analysis','Análise ao vivo'],['orders','Operações'],['inv','Créditos INV'],['settings','Configurações Binance']];
  return <div>
    <div className="page-title"><h1>Painel Cliente</h1><p>Robô em modo simulação usando candles reais da Binance.</p></div>
    <div className="tabbar">{tabs.map(([k,l])=><button key={k} className={activeTab===k?'active':''} onClick={()=>setActiveTab(k)}>{l}</button>)}</div>
    {activeTab==='dashboard' && <Dashboard state={state} setState={setState} symbol={symbol} setSymbol={setSymbol} lastPrice={lastPrice}/>}
    {activeTab==='analysis' && <LiveAnalysis symbol={symbol} setSymbol={setSymbol} candles={candles} state={state}/>}
    {activeTab==='orders' && <Orders orders={state.orders}/>}
    {activeTab==='inv' && <INV state={state}/>}
    {activeTab==='settings' && <BinanceSettings/>}
  </div>
}

function Dashboard({state,setState,symbol,setSymbol,lastPrice}){
  return <div className="grid dashboard-grid">
    <Card icon={<Bot/>} title="Status do robô" value={state.active?'ROBÔ ATIVO':'PAUSADO'} desc={state.active?'Analisando mercado real em paper trade':'Clique em iniciar para simular'}/>
    <Card icon={<CreditCard/>} title="Saldo INV" value={`${num(state.invBalance,2)} INV`} desc={state.invBalance<=1?'Crédito baixo':'Créditos disponíveis'}/>
    <Card icon={<Activity/>} title="Lucro simulado" value={brl(state.realizedProfitBrl)} desc={`Taxa simulada: ${num(state.feesInv,2)} INV`}/>
    <Card icon={<Settings/>} title="Ativo" value={symbol} desc={`Preço: ${lastPrice?lastPrice.toFixed(2):'...'}`}/>
    <div className="panel wide">
      <div className="controls">
        <select value={symbol} onChange={e=>setSymbol(e.target.value)}>{symbols.map(s=><option key={s}>{s}</option>)}</select>
        <button className="btn primary" onClick={()=>setState(s=>({...s,active:true,symbol}))}><Play size={16}/> Iniciar robô</button>
        <button className="btn danger" onClick={()=>setState(s=>({...s,active:false}))}><Pause size={16}/> Pausar</button>
      </div>
      <p className="muted">Modo atual: <b>Paper Trade</b>. As ordens aparecem no painel, mas não são enviadas para a Binance real.</p>
    </div>
    <div className="panel wide"><h3>Últimas decisões</h3><DecisionList decisions={state.decisions}/></div>
  </div>
}
function Card({icon,title,value,desc}){return <div className="card"><div className="card-icon">{icon}</div><span>{title}</span><strong>{value}</strong><small>{desc}</small></div>}

function LiveAnalysis({symbol,setSymbol,candles,state}){
  const elId='chart-'+symbol;
  useEffect(()=>{
    const el=document.getElementById(elId); if(!el||!candles.length) return; el.innerHTML='';
    const chart=createChart(el,{height:460,layout:{background:{color:'#08111f'},textColor:'#cbd5e1'},grid:{vertLines:{color:'#15233a'},horzLines:{color:'#15233a'}},rightPriceScale:{borderColor:'#23334d'},timeScale:{borderColor:'#23334d'}});
    const series=chart.addCandlestickSeries({upColor:'#22c55e',downColor:'#ef4444',borderVisible:false,wickUpColor:'#22c55e',wickDownColor:'#ef4444'});
    series.setData(candles);
    chart.timeScale().fitContent();
    return()=>chart.remove();
  },[candles,elId]);
  const last=state.decisions[0];
  return <div className="analysis-layout">
    <div className="chart-card"><div className="chart-head"><h3>Espelho do gráfico real — {symbol}</h3><select value={symbol} onChange={e=>setSymbol(e.target.value)}>{symbols.map(s=><option key={s}>{s}</option>)}</select></div><div id={elId} className="chartbox"/></div>
    <div className="panel decision-panel"><h3>Motor de análise</h3>
      <div className="status-pill">{state.active?'🟢 ROBÔ ATIVO':'⚪ PAUSADO'}</div>
      <p><b>Regime:</b> {last?.regime||'Carregando'}</p><p><b>Ação:</b> {last?.action||'WAIT'}</p><p><b>Score:</b> {last?.score||0}</p><p><b>Motivo:</b> {last?.reason||'Aguardando candle'}</p>
      <p><b>Suporte:</b> {last?.support?.toFixed?.(2)||'-'}</p><p><b>Resistência:</b> {last?.resistance?.toFixed?.(2)||'-'}</p>
      <h4>Cesta atual</h4>{state.positions.length?state.positions.map(p=><p key={p.id}>{p.symbol}: {num(p.qty,8)} @ {p.avgPrice.toFixed(2)}</p>):<p className="muted">Sem posição aberta.</p>}
    </div>
  </div>
}
function DecisionList({decisions}){return <div className="table-wrap"><table><thead><tr><th>Hora</th><th>Ativo</th><th>Ação</th><th>Score</th><th>Motivo</th></tr></thead><tbody>{decisions.slice(0,8).map((d,i)=><tr key={i}><td>{new Date(d.at).toLocaleTimeString('pt-BR')}</td><td>{d.symbol}</td><td>{d.action}</td><td>{d.score}</td><td>{d.reason}</td></tr>)}</tbody></table></div>}
function Orders({orders}){return <div className="panel"><h3>Histórico de operações</h3><div className="table-wrap"><table><thead><tr><th>Hora</th><th>Side</th><th>Ativo</th><th>Preço</th><th>Valor</th><th>Lucro</th><th>Taxa INV</th></tr></thead><tbody>{orders.map(o=><tr key={o.id}><td>{new Date(o.at).toLocaleString('pt-BR')}</td><td>{o.side}</td><td>{o.symbol}</td><td>{o.price.toFixed(2)}</td><td>{brl(o.valueBrl||0)}</td><td>{o.profitBrl?brl(o.profitBrl):'-'}</td><td>{o.feeInv?num(o.feeInv,2):'-'}</td></tr>)}</tbody></table></div></div>}
function INV({state}){return <div className="panel"><h3>Créditos INV</h3><p>Saldo atual: <b>{num(state.invBalance,2)} INV</b></p><p>1 INV = R$ 1,00. No modo real, o sistema descontará 10% do lucro realizado. No modo paper, a taxa é apenas simulada.</p><div className="alert">Quando o INV zerar, o robô pausa e solicita recarga.</div></div>}
function BinanceSettings(){return <div className="panel"><h3><KeyRound size={18}/> Configurações Binance</h3><p className="muted">MVP visual. As credenciais reais devem ser criptografadas no backend. Nunca peça permissão de saque.</p><label>API Key</label><input placeholder="Cole a API Key"/><label>Secret Key</label><input type="password" placeholder="Cole a Secret Key"/><button className="btn primary">Testar conexão</button><div className="alert">Permissões recomendadas: leitura + spot trading. Saque deve estar desativado.</div></div>}
