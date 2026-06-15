export function onlyDigits(value='') { return String(value).replace(/\D/g, ''); }

export function maskCpf(cpf='') {
  const d = onlyDigits(cpf).slice(0, 11);
  return d.replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d{1,2})$/, '$1-$2');
}

export function maskPhone(phone='') {
  const d = onlyDigits(phone).slice(0, 11);
  if (d.length <= 10) return d.replace(/(\d{2})(\d)/, '($1) $2').replace(/(\d{4})(\d)/, '$1-$2');
  return d.replace(/(\d{2})(\d)/, '($1) $2').replace(/(\d{5})(\d)/, '$1-$2');
}

export function isValidCpf(cpf='') {
  const d = onlyDigits(cpf);
  if (d.length !== 11 || /^(\d)\1+$/.test(d)) return false;
  let sum=0; for(let i=0;i<9;i++) sum += Number(d[i])*(10-i);
  let check = 11 - (sum % 11); if(check >= 10) check=0;
  if(check !== Number(d[9])) return false;
  sum=0; for(let i=0;i<10;i++) sum += Number(d[i])*(11-i);
  check = 11 - (sum % 11); if(check >= 10) check=0;
  return check === Number(d[10]);
}

export async function sha256(text) {
  const data = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash)).map(b=>b.toString(16).padStart(2,'0')).join('');
}
