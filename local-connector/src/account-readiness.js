export function accountReadiness(accountPayload, environment = 'live') {
  const balances = Array.isArray(accountPayload?.balances) ? accountPayload.balances : [];
  const usdt = balances.find(item => item.asset === 'USDT') || { free: '0', locked: '0' };
  const canTrade = Boolean(accountPayload?.canTrade);
  const permissions = Array.isArray(accountPayload?.permissions) ? accountPayload.permissions : [];
  const hasSpot = permissions.length
    ? permissions.includes('SPOT')
    : String(accountPayload?.accountType || 'SPOT').toUpperCase() === 'SPOT';

  // /api/v3/account informa a capacidade da conta em canWithdraw, e nao
  // uma confirmacao da permissao de saque configurada na chave API.
  const accountCanWithdraw = Boolean(accountPayload?.canWithdraw);
  const credentialStatus = canTrade && hasSpot ? 'active' : 'review_required';
  const productionReady = environment === 'live' && credentialStatus === 'active';

  return {
    canTrade,
    canWithdraw: false,
    accountCanWithdraw,
    withdrawPermissionVerified: false,
    withdrawPermissionStatus: 'manual_check_required',
    hasSpot,
    credentialStatus,
    productionReady,
    usdtFree: Number(usdt.free || 0),
    usdtLocked: Number(usdt.locked || 0)
  };
}
