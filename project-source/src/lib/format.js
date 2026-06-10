export const brl = (v=0) => Number(v).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
export const usd = (v=0) => Number(v).toLocaleString('en-US',{style:'currency',currency:'USD'});
export const usdt = (v=0) => `${Number(v).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})} USDT`;
export const env = (v=0) => `${Number(v).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})} ENV`;
export const pct = (v=0) => `${Number(v).toFixed(2)}%`;
export const num = (v=0,d=2) => Number(v).toLocaleString('pt-BR',{minimumFractionDigits:d,maximumFractionDigits:d});
