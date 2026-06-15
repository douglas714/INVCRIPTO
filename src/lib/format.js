export const brl = (v=0) => Number(v).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
export const usd = (v=0) => Number(v).toLocaleString('en-US',{style:'currency',currency:'USD'});
export const pct = (v=0) => `${Number(v).toFixed(2)}%`;
export const num = (v=0,d=2) => Number(v).toLocaleString('pt-BR',{minimumFractionDigits:d,maximumFractionDigits:d});
