import React, { useEffect, useMemo, useState } from 'react';
import { CandlestickSeries, createChart } from 'lightweight-charts';
import { initialPaperState, runPaperDecision } from '../lib/paperBot.js';
import { brl, num } from '../lib/format.js';
import { getAllowedSymbols, getRiskProfile, RISK_PROFILES, formatPct } from '../lib/riskProfiles.js';
import { Activity, Bot, CreditCard, KeyRound, Pause, Play, Settings, ShieldCheck } from 'lucide-react';

export default function ClientPanel({ user }) {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [state, setState] = useState(() => {
    const saved = JSON.parse(localStorage.getItem('df_paper_state') || 'null');
    return saved || initialPaperState(Number(import.meta.env.VITE_DEFAULT_PAPER_BALANCE_BRL || 1000));
  });
  const profile = getRiskProfile(state.riskProfile);
  const symbols = getAllowedSymbols(state.riskProfile);
  const [symbol, setSymbol] = useState(state.symbol && symbols.includes(state.symbol) ? state.symbol : symbols[0]);
  const [candles, setCandles] = useState([]);
  const lastPrice = candles.at(-1)?.close || 0;

  useEffect(() => {
    if (!symbols.includes(symbol)) setSymbol(symbols[0]);
  }, [state.riskProfile]);

  useEffect(() => {
    localStorage.setItem('df_paper_state', JSON.stringify({ ...state, symbol }));
  }, [state, symbol]);

  useEffect(() => {
    let closed = false;
    async function load() {
      const res = await fetch(`/.netlify/functions/binance-klines?symbol=${symbol}&interval=1m&limit=240`).catch(() => null);
      let data = [];
      if (res?.ok) data = await res.json();
      if (!data.length) {
        const r = await fetch(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=1m&limit=240`);
        data = await r.json();
      }
      if (!closed) {
        setCandles(data.map(k => ({
          time: Math.floor(k[0] / 1000),
          open: +k[1],
          high: +k[2],
          low: +k[3],
          close: +k[4],
          volume: +k[5]
        })));
      }
    }
    load();
    const t = setInterval(load, 15000);
    return () => { closed = true; clearInterval(t); };
  }, [symbol]);

  useEffect(() => {
    if (state.active && candles.length) {
      const t = setInterval(() => setState(s => runPaperDecision({ ...s, symbol }, candles)), 10000);
      return () => clearInterval(t);
    }
  }, [state.active, candles, symbol]);

  const resetDemo = () => setState(initialPaperState(Number(import.meta.env.VITE_DEFAULT_PAPER_BALANCE_BRL || 1000), state.riskProfile));
  const tabs = [['dashboard', 'Dashboard'], ['analysis', 'Analise ao vivo'], ['orders', 'Operacoes'], ['inv', 'Creditos INV'], ['settings', 'Configuracoes Binance']];

  return <div>
    <div className="page-title"><h1>Painel Cliente</h1><p>Robo Spot com cesta inteligente, perfis de risco e protecoes controladas.</p></div>
    <div className="tabbar">{tabs.map(([k, l]) => <button key={k} className={activeTab === k ? 'active' : ''} onClick={() => setActiveTab(k)}>{l}</button>)}</div>
    {activeTab === 'dashboard' && <Dashboard state={state} setState={setState} symbol={symbol} setSymbol={setSymbol} lastPrice={lastPrice} onReset={resetDemo} profile={profile} symbols={symbols} />}
    {activeTab === 'analysis' && <LiveAnalysis symbol={symbol} setSymbol={setSymbol} candles={candles} state={state} profile={profile} symbols={symbols} />}
    {activeTab === 'orders' && <Orders orders={state.orders} onReset={resetDemo} />}
    {activeTab === 'inv' && <INV state={state} profile={profile} />}
    {activeTab === 'settings' && <BinanceSettings />}
  </div>;
}

function Dashboard({ state, setState, symbol, setSymbol, lastPrice, onReset, profile, symbols }) {
  const openBasket = state.positions.find(p => p.symbol === symbol);
  const investedUsdt = state.positions.reduce((s, p) => s + Number(p.investedUsdt || 0), 0);
  const availableBrl = Number(state.availableUsdt || 0) * 5.2;
  return <div className="grid dashboard-grid">
    <Card icon={<Bot />} title="Status do robo" value={state.active ? 'ROBO ATIVO' : 'PAUSADO'} desc={state.active ? `Operando setup ${profile.label}` : state.stoppedReason || 'Clique em iniciar para simular'} />
    <Card icon={<ShieldCheck />} title="Perfil / Alavancagem" value={`${profile.label} ${profile.leverage}x`} desc={profile.realLeverageEnabled ? 'Alavancagem real ativa' : 'Alavancagem operacional Spot'} />
    <Card icon={<CreditCard />} title="Saldo INV" value={`${num(state.invBalance, 2)} INV`} desc={state.invBalance <= 1 ? 'Credito baixo' : 'Creditos disponiveis'} />
    <Card icon={<Activity />} title="Lucro realizado" value={brl(state.realizedProfitBrl)} desc={`Taxa acumulada: ${num(state.feesInv, 2)} INV`} />

    <div className="panel wide">
      <div className="controls">
        <select value={symbol} onChange={e => setSymbol(e.target.value)}>{symbols.map(s => <option key={s}>{s}</option>)}</select>
        <select value={state.riskProfile} onChange={e => setState(s => ({ ...s, riskProfile: e.target.value, symbol: getAllowedSymbols(e.target.value)[0] }))}>
          {Object.values(RISK_PROFILES).map(p => <option key={p.id} value={p.id}>{p.label} - {p.leverage}x</option>)}
        </select>
        <button className="btn primary" onClick={() => setState(s => ({ ...s, active: true, symbol, stoppedReason: '' }))}><Play size={16} /> Iniciar robo</button>
        <button className="btn danger" onClick={() => setState(s => ({ ...s, active: false }))}><Pause size={16} /> Pausar</button>
        <button className="btn ghost" onClick={onReset}>Zerar demo</button>
      </div>
      <p className="muted">Modo atual: <b>Paper Trade</b>. O setup foi preparado para Spot com cesta; alavancagem real permanece bloqueada no código desta versão.</p>
    </div>

    <div className="panel wide">
      <h3>Setup operacional ativo</h3>
      <div className="setup-grid">
        <Metric label="Entrada inicial" value={formatPct(profile.initialEntryPct)} />
        <Metric label="Max. cesta" value={formatPct(profile.maxBasketExposurePct)} />
        <Metric label="Reserva" value={formatPct(profile.requiredReservePct)} />
        <Metric label="Protecoes" value={profile.maxProtections} />
        <Metric label="Score entrada" value={profile.minEntryScore} />
        <Metric label="Score protecao" value={profile.minProtectionScore} />
        <Metric label="Alvo micro" value={formatPct(profile.microTakeProfitPct)} />
        <Metric label="Stop diario" value={`-${formatPct(profile.dailyStopLossPct)}`} />
      </div>
      <p className="muted">{profile.description}</p>
    </div>

    <div className="panel wide">
      <h3>Cesta atual</h3>
      {openBasket ? <div className="setup-grid">
        <Metric label="Ativo" value={openBasket.symbol} />
        <Metric label="Preco medio" value={num(openBasket.avgPrice, 2)} />
        <Metric label="Quantidade" value={num(openBasket.qty, 8)} />
        <Metric label="Investido" value={`USDT ${num(openBasket.investedUsdt, 2)}`} />
        <Metric label="Protecoes abertas" value={`${openBasket.protectionCount}/${profile.maxProtections}`} />
        <Metric label="Preco atual" value={lastPrice ? num(lastPrice, 2) : '...'} />
      </div> : <p className="muted">Sem cesta aberta no ativo selecionado.</p>}
      <p className="muted">Saldo livre estimado: <b>{brl(availableBrl)}</b> | Exposicao aberta: <b>USDT {num(investedUsdt, 2)}</b></p>
    </div>

    <div className="panel wide"><h3>Ultimas decisoes</h3><DecisionList decisions={state.decisions} /></div>
  </div>;
}

function Card({ icon, title, value, desc }) {
  return <div className="card"><div className="card-icon">{icon}</div><span>{title}</span><strong>{value}</strong><small>{desc}</small></div>;
}

function Metric({ label, value }) {
  return <div className="metric"><span>{label}</span><strong>{value}</strong></div>;
}

function LiveAnalysis({ symbol, setSymbol, candles, state, profile, symbols }) {
  const elId = `chart-${symbol}`;
  useEffect(() => {
    const el = document.getElementById(elId);
    if (!el || !candles.length) return;
    el.innerHTML = '';
    const chart = createChart(el, { height: 460, layout: { background: { color: '#08111f' }, textColor: '#cbd5e1' }, grid: { vertLines: { color: '#15233a' }, horzLines: { color: '#15233a' } }, rightPriceScale: { borderColor: '#23334d' }, timeScale: { borderColor: '#23334d' } });
    const candleOptions = { upColor: '#22c55e', downColor: '#ef4444', borderVisible: false, wickUpColor: '#22c55e', wickDownColor: '#ef4444' };
    const series = chart.addCandlestickSeries ? chart.addCandlestickSeries(candleOptions) : chart.addSeries(CandlestickSeries, candleOptions);
    series.setData(candles);
    chart.timeScale().fitContent();
    return () => chart.remove();
  }, [candles, elId]);
  const last = state.decisions[0];
  const openPositions = state.positions.filter(p => p.status !== 'closed');
  return <div className="analysis-layout">
    <div className="chart-card"><div className="chart-head"><h3>Espelho do grafico real - {symbol}</h3><select value={symbol} onChange={e => setSymbol(e.target.value)}>{symbols.map(s => <option key={s}>{s}</option>)}</select></div><div id={elId} className="chartbox" /></div>
    <div className="panel decision-panel"><h3>Motor de analise</h3>
      <div className="status-pill">{state.active ? 'ROBO ATIVO' : 'PAUSADO'}</div>
      <p><b>Perfil:</b> {profile.label} / {profile.leverage}x operacional</p>
      <p><b>Estado:</b> {last?.state || 'SCANNING'}</p>
      <p><b>Regime:</b> {last?.regime || 'Carregando'}</p><p><b>Acao:</b> {last?.action || 'WAIT'}</p><p><b>Score:</b> {last?.score || 0}</p><p><b>Motivo:</b> {last?.reason || 'Aguardando candle'}</p>
      <p><b>1m/5m/15m:</b> {last?.trend1m || '-'} / {last?.trend5m || '-'} / {last?.trend15m || '-'}</p>
      <p><b>RSI:</b> {last?.rsi ? num(last.rsi, 1) : '-'} | <b>ATR:</b> {last?.atrPct ? formatPct(last.atrPct) : '-'}</p>
      <p><b>Suporte:</b> {last?.support?.toFixed?.(2) || '-'}</p><p><b>Resistencia:</b> {last?.resistance?.toFixed?.(2) || '-'}</p>
      <p><b>Dist. resistencia:</b> {last?.distToResistancePct !== undefined ? formatPct(last.distToResistancePct) : '-'}</p>
      <h4>Cestas abertas</h4>{openPositions.length ? openPositions.map(p => <p key={p.id}>{p.symbol}: {num(p.qty, 8)} @ {p.avgPrice.toFixed(2)} | protecoes {p.protectionCount}</p>) : <p className="muted">Sem posicao aberta.</p>}
    </div>
  </div>;
}

function DecisionList({ decisions }) {
  return <div className="table-wrap"><table><thead><tr><th>Hora</th><th>Ativo</th><th>Estado</th><th>Acao</th><th>Score</th><th>Motivo</th></tr></thead><tbody>{decisions.slice(0, 10).map((d, i) => <tr key={i}><td>{new Date(d.at).toLocaleTimeString('pt-BR')}</td><td>{d.symbol}</td><td>{d.state || '-'}</td><td>{d.action}</td><td>{d.score}</td><td>{d.reason}</td></tr>)}</tbody></table></div>;
}

function Orders({ orders, onReset }) {
  return <div className="panel"><div className="panel-head"><h3>Historico de operacoes demo</h3><button className="btn ghost" onClick={onReset}>Zerar operacoes demo</button></div><div className="table-wrap"><table><thead><tr><th>Hora</th><th>Side</th><th>Ativo</th><th>Preco</th><th>Valor</th><th>Lucro</th><th>Taxa INV</th><th>Motivo</th></tr></thead><tbody>{orders.length ? orders.map(o => <tr key={o.id}><td>{new Date(o.at).toLocaleString('pt-BR')}</td><td>{o.side}</td><td>{o.symbol}</td><td>{o.price.toFixed(2)}</td><td>{o.valueUsdt ? `USDT ${num(o.valueUsdt, 2)}` : brl(o.valueBrl || 0)}</td><td>{o.profitBrl ? brl(o.profitBrl) : '-'}</td><td>{o.feeInv ? num(o.feeInv, 2) : '-'}</td><td>{o.reason || '-'}</td></tr>) : <tr><td colSpan="8">Nenhuma operacao demo registrada.</td></tr>}</tbody></table></div></div>;
}

function INV({ state, profile }) {
  return <div className="panel"><h3>Creditos INV</h3><p>Saldo atual: <b>{num(state.invBalance, 2)} INV</b></p><p>1 INV = R$ 1,00. No modo real, o sistema desconta {formatPct(profile.invFeePct)} do lucro realizado. No modo paper, a taxa e apenas simulada.</p><div className="alert">Quando o INV zerar, o robo pausa e solicita recarga.</div></div>;
}

function BinanceSettings() {
  return <div className="panel"><h3><KeyRound size={18} /> Configuracoes Binance</h3><p className="muted">Credenciais reais devem ficar criptografadas no backend. Nunca habilite permissao de saque. Para conta real, valide IP, permissao Spot Trading e limite operacional antes de iniciar.</p><label>API Key</label><input placeholder="Cole a API Key" /><label>Secret Key</label><input type="password" placeholder="Cole a Secret Key" /><button className="btn primary">Testar conexao</button><div className="alert">Permissoes recomendadas: leitura + spot trading. Saque deve estar desativado.</div></div>;
}
