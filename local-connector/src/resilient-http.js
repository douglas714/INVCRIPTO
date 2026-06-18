export class HttpRequestError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'HttpRequestError';
    Object.assign(this, details);
  }
}

export function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
}

export function compactError(error) {
  if (!error) return 'Erro desconhecido';
  const parts = [error.message || String(error)];
  if (error.code) parts.push(`code=${error.code}`);
  if (error.cause?.code) parts.push(`cause=${error.cause.code}`);
  return [...new Set(parts.filter(Boolean))].join(' | ');
}

export function isRetryableStatus(status) {
  return [408, 425, 429, 500, 502, 503, 504].includes(Number(status));
}

export function isNetworkError(error) {
  const code = String(error?.code || error?.cause?.code || '').toUpperCase();
  const message = String(error?.message || error || '').toLowerCase();
  return [
    'ABORT_ERR', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT',
    'UND_ERR_SOCKET', 'ECONNRESET', 'ECONNREFUSED', 'ENOTFOUND',
    'EAI_AGAIN', 'ETIMEDOUT', 'ENETUNREACH', 'EHOSTUNREACH'
  ].includes(code) || /fetch failed|network|socket|timeout|timed out|aborted/.test(message);
}

function retryDelay(attempt, baseDelayMs, maxDelayMs) {
  const exponential = Math.min(maxDelayMs, baseDelayMs * (2 ** Math.max(0, attempt - 1)));
  const jitter = Math.floor(Math.random() * Math.max(50, exponential * 0.2));
  return exponential + jitter;
}

export async function fetchWithRetry(url, options = {}, config = {}) {
  const method = String(options.method || 'GET').toUpperCase();
  const attempts = Math.max(1, Number(config.attempts ?? (['GET', 'HEAD'].includes(method) ? 4 : 1)));
  const timeoutMs = Math.max(1000, Number(config.timeoutMs || 12000));
  const baseDelayMs = Math.max(50, Number(config.baseDelayMs || 350));
  const maxDelayMs = Math.max(baseDelayMs, Number(config.maxDelayMs || 5000));
  const label = String(config.label || `${method} ${url}`);
  const retryUnsafe = Boolean(config.retryUnsafe);
  const retryMethod = ['GET', 'HEAD', 'PUT', 'PATCH', 'DELETE'].includes(method) || retryUnsafe;
  let lastError = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error(`timeout ${timeoutMs}ms`)), timeoutMs);
    try {
      const response = await fetch(url, { ...options, signal: controller.signal });
      clearTimeout(timer);
      if (retryMethod && isRetryableStatus(response.status) && attempt < attempts) {
        try { await response.body?.cancel?.(); } catch {}
        await sleep(retryDelay(attempt, baseDelayMs, maxDelayMs));
        continue;
      }
      return response;
    } catch (error) {
      clearTimeout(timer);
      lastError = error;
      if (!retryMethod || !isNetworkError(error) || attempt >= attempts) break;
      await sleep(retryDelay(attempt, baseDelayMs, maxDelayMs));
    }
  }

  throw new HttpRequestError(`${label}: ${compactError(lastError)}`, {
    url,
    method,
    code: lastError?.code || lastError?.cause?.code || 'NETWORK_ERROR',
    cause: lastError,
    retryable: true
  });
}
