export type PublicFundingRow = {
  fundingTime: number;
  fundingRatePercent: number;
};

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

const FUNDING_API = 'https://api.bybit.com/v5/market/funding/history';
const PAGE_SIZE = 200;
const SYMBOLS: Record<string, string> = {
  SHIBUSDT: 'SHIB1000USDT',
};

export async function fetchPublicFundingHistory(
  symbol: string,
  startTime: number,
  endTime: number,
  request: FetchLike = fetch,
): Promise<PublicFundingRow[]> {
  const rows = new Map<number, PublicFundingRow>();
  let cursorEnd = endTime;

  while (cursorEnd > startTime) {
    const params = new URLSearchParams({
      category: 'linear',
      symbol: SYMBOLS[symbol] ?? symbol,
      startTime: String(startTime),
      endTime: String(cursorEnd),
      limit: String(PAGE_SIZE),
    });
    const response = await request(`${FUNDING_API}?${params}`, { headers: { accept: 'application/json' } });
    if (!response.ok) throw new Error(`Bybit funding request failed with HTTP ${response.status}.`);

    const payload: unknown = await response.json();
    if (!isRecord(payload) || payload.retCode !== 0 || !isRecord(payload.result) || !Array.isArray(payload.result.list)) {
      const code = isRecord(payload) ? String(payload.retCode ?? 'unknown') : 'invalid payload';
      const message = isRecord(payload) ? String(payload.retMsg ?? '') : '';
      throw new Error(`Bybit funding request failed (${code}${message ? `: ${message}` : ''}).`);
    }

    const page = payload.result.list.map((item, index) => parseFundingRow(item, `${symbol}[${index}]`));
    for (const row of page) {
      if (row.fundingTime >= startTime && row.fundingTime < endTime) rows.set(row.fundingTime, row);
    }
    if (page.length < PAGE_SIZE) break;

    const oldest = Math.min(...page.map((row) => row.fundingTime));
    const nextEnd = oldest - 1;
    if (!Number.isFinite(oldest) || nextEnd >= cursorEnd) throw new Error(`Bybit funding pagination did not advance for ${symbol}.`);
    cursorEnd = nextEnd;
  }

  return [...rows.values()].sort((a, b) => a.fundingTime - b.fundingTime);
}

function parseFundingRow(value: unknown, label: string): PublicFundingRow {
  if (!isRecord(value)) throw new Error(`Unexpected Bybit funding row for ${label}.`);
  const fundingTime = parseNumber(value.fundingRateTimestamp, `${label} timestamp`);
  const fundingRatePercent = parseNumber(value.fundingRate, `${label} rate`) * 100;
  return { fundingTime, fundingRatePercent };
}

function parseNumber(value: unknown, label: string): number {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
  if (!Number.isFinite(parsed)) throw new Error(`${label} is not finite.`);
  return parsed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
