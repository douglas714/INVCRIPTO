export const RISK_PROFILES = {
  conservative: {
    id: 'conservative',
    label: 'Conservador',
    description: 'Mais seguro: opera menos, exige setups fortes e preserva metade da banca livre.',
    mode: 'SPOT',
    leverageMode: 'operational',
    leverage: 1,
    realLeverageEnabled: false,
    initialEntryPct: 0.10,
    maxBasketExposurePct: 0.50,
    requiredReservePct: 0.50,
    protectionLevels: [0.15, 0.20],
    protectionDropPct: [0.006, 0.014],
    maxProtections: 2,
    maxOpenBaskets: 1,
    minEntryScore: 82,
    minBreakoutScore: 90,
    minProtectionScore: 78,
    microTakeProfitPct: 0.0035,
    basketTakeProfitPct: 0.0025,
    dailyStopLossPct: 0.015,
    dailyStopWinPct: 0.015,
    maxDistanceFromAvgPct: 0.045,
    cooldownAfterLossMinutes: 45,
    invFeePct: 0.25,
    allowedSymbols: ['BTCUSDT', 'ETHUSDT']
  },
  moderate: {
    id: 'moderate',
    label: 'Moderado',
    description: 'Perfil padrão: equilibra geração de operações com controle de exposição.',
    mode: 'SPOT',
    leverageMode: 'operational',
    leverage: 1.5,
    realLeverageEnabled: false,
    initialEntryPct: 0.10,
    maxBasketExposurePct: 0.70,
    requiredReservePct: 0.30,
    protectionLevels: [0.15, 0.20, 0.25],
    protectionDropPct: [0.005, 0.012, 0.022],
    maxProtections: 3,
    maxOpenBaskets: 2,
    minEntryScore: 75,
    minBreakoutScore: 85,
    minProtectionScore: 72,
    microTakeProfitPct: 0.005,
    basketTakeProfitPct: 0.0035,
    dailyStopLossPct: 0.03,
    dailyStopWinPct: 0.03,
    maxDistanceFromAvgPct: 0.065,
    cooldownAfterLossMinutes: 20,
    invFeePct: 0.25,
    allowedSymbols: ['BTCUSDT', 'ETHUSDT']
  },
  aggressive: {
    id: 'aggressive',
    label: 'Agressivo',
    description: 'Mais giro e maior exposição. Mantém trava para evitar DCA infinito.',
    mode: 'SPOT',
    leverageMode: 'operational',
    leverage: 2,
    realLeverageEnabled: false,
    initialEntryPct: 0.15,
    maxBasketExposurePct: 0.85,
    requiredReservePct: 0.15,
    protectionLevels: [0.15, 0.20, 0.25, 0.10],
    protectionDropPct: [0.004, 0.010, 0.018, 0.030],
    maxProtections: 4,
    maxOpenBaskets: 3,
    minEntryScore: 68,
    minBreakoutScore: 82,
    minProtectionScore: 68,
    microTakeProfitPct: 0.004,
    basketTakeProfitPct: 0.003,
    dailyStopLossPct: 0.05,
    dailyStopWinPct: 0.05,
    maxDistanceFromAvgPct: 0.085,
    cooldownAfterLossMinutes: 10,
    invFeePct: 0.25,
    allowedSymbols: ['BTCUSDT', 'ETHUSDT']
  }
};

export const DEFAULT_PROFILE_ID = 'moderate';

export function getRiskProfile(profileId = DEFAULT_PROFILE_ID) {
  return RISK_PROFILES[profileId] || RISK_PROFILES[DEFAULT_PROFILE_ID];
}


export function getAllowedSymbols(profileId = DEFAULT_PROFILE_ID) {
  return getRiskProfile(profileId).allowedSymbols;
}

export function getRiskProfileOptions() {
  return Object.values(RISK_PROFILES);
}

export function formatPct(value = 0) {
  return `${(Number(value || 0) * 100).toFixed(2)}%`;
}
