import { ASSET_SYMBOLS, type AssetSymbol, type CoverageRegime, type SignalLabel, type SignalTimeframe } from '@/lib/signals';

export const HOLDINGS_POLICY_VERSION = 'holdings-v1';
export const HOLDINGS_STORAGE_KEY = 'crypto-signal-dashboard:holdings-v2';
export const MAX_IMPORT_BYTES = 256_000;
const MAX_KRW = 1_000_000_000_000_000;
const MAX_QUANTITY = 1_000_000_000_000;
const CONCENTRATION_PERCENT = 50;

export type Holding = {
  id: string;
  symbol: AssetSymbol;
  averageBuyPriceKrw: number;
  quantity: number | null;
  investedPrincipalKrw: number | null;
  firstBuyDate: string | null;
  recentBuyDate: string | null;
  targetDeadline: string | null;
  memo: string;
  lossSalePreference: boolean;
};

export type HoldingDraft = Omit<Holding, 'id'> & { id?: string };

export type HoldingMarketSnapshot = {
  currentPriceKrw: number | null;
  asOf: string;
  signalBarClose: string;
  signalTimeframe: SignalTimeframe;
  score: number;
  signalLabel: SignalLabel;
  extremeEligible: boolean;
  coverageRegime: CoverageRegime;
  availableWeight: number;
  extremeCoverageFloor: number;
  stale: boolean;
  trendConfirmed: boolean;
  trendBroken: boolean;
  sellThresholdCrossed: boolean;
  backtest: { sampleCount: number; evaluated: number; excluded: number; outOfSampleValidated: boolean } | null;
};

export type HoldingStatus = '추가매수 검토' | '보유' | '비중축소 검토' | '데이터 부족';

export type HoldingEvaluation = {
  policyVersion: typeof HOLDINGS_POLICY_VERSION;
  status: HoldingStatus;
  confidence: 'low' | 'medium';
  metrics: {
    costBasisKrw: number;
    marketValueKrw: number | null;
    profitKrw: number | null;
    returnPercent: number;
    portfolioWeightPercent: number | null;
  };
  reasons: string[];
  conflicts: string[];
  checklist: string[];
  invalidationConditions: string[];
};

export function validateHoldingDraft(draft: HoldingDraft): { ok: true; value: Holding; warnings: string[] } | { ok: false; errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!ASSET_SYMBOLS.includes(draft.symbol)) errors.push('지원하지 않는 자산입니다.');
  if (!isSafePositive(draft.averageBuyPriceKrw, MAX_KRW)) errors.push('평균매수가가 유효한 양수 범위를 벗어났습니다.');
  if (draft.quantity !== null && !isSafePositive(draft.quantity, MAX_QUANTITY)) errors.push('수량이 유효한 양수 범위를 벗어났습니다.');
  if (draft.investedPrincipalKrw !== null && !isSafePositive(draft.investedPrincipalKrw, MAX_KRW)) errors.push('총투자원금이 유효한 양수 범위를 벗어났습니다.');
  if (draft.quantity === null && draft.investedPrincipalKrw === null) errors.push('수량 또는 총투자원금 중 하나가 필요합니다.');
  for (const [label, date] of [['최초 매수일', draft.firstBuyDate], ['최근 매수일', draft.recentBuyDate], ['목표매도기한', draft.targetDeadline]] as const) {
    if (date !== null && !isIsoDate(date)) errors.push(`${label}이 유효한 날짜가 아닙니다.`);
  }
  if (draft.firstBuyDate && draft.recentBuyDate && draft.firstBuyDate > draft.recentBuyDate) errors.push('최초 매수일은 최근 매수일보다 늦을 수 없습니다.');
  if (draft.memo.length > 500) errors.push('메모는 500자 이하여야 합니다.');
  if (draft.quantity !== null && draft.investedPrincipalKrw !== null && isSafePositive(draft.averageBuyPriceKrw, MAX_KRW)) {
    const calculated = draft.averageBuyPriceKrw * draft.quantity;
    if (Math.abs(calculated - draft.investedPrincipalKrw) / draft.investedPrincipalKrw >= 0.05) warnings.push('수량 기준 원금과 입력한 총투자원금이 5% 이상 다릅니다.');
  }
  if (draft.quantity !== null && isSafePositive(draft.averageBuyPriceKrw, MAX_KRW) && draft.averageBuyPriceKrw * draft.quantity > MAX_KRW) errors.push('평균매수가와 수량으로 계산한 원금이 허용 범위를 초과했습니다.');
  if (errors.length > 0) return { ok: false, errors, warnings };
  return {
    ok: true,
    value: {
      ...draft,
      id: draft.id?.trim() || `holding-${draft.symbol.toLowerCase()}`,
      memo: draft.memo.trim(),
    },
    warnings,
  };
}

export function parseHoldingsStorage(raw: string | null): Holding[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as { version?: unknown; holdings?: unknown };
    if ((parsed.version !== 1 && parsed.version !== 2) || !Array.isArray(parsed.holdings)) return [];
    const valid = parsed.holdings.flatMap((candidate) => {
      if (!candidate || typeof candidate !== 'object') return [];
      const row = candidate as Partial<Holding>;
      const validation = validateHoldingDraft({
        id: typeof row.id === 'string' ? row.id : undefined,
        symbol: row.symbol as AssetSymbol,
        averageBuyPriceKrw: row.averageBuyPriceKrw as number,
        quantity: row.quantity === undefined ? null : (row.quantity as number | null),
        investedPrincipalKrw: row.investedPrincipalKrw === undefined ? null : (row.investedPrincipalKrw as number | null),
        firstBuyDate: typeof row.firstBuyDate === 'string' ? row.firstBuyDate : null,
        recentBuyDate: typeof row.recentBuyDate === 'string' ? row.recentBuyDate : null,
        targetDeadline: typeof row.targetDeadline === 'string' ? row.targetDeadline : null,
        memo: typeof row.memo === 'string' ? row.memo : '',
        lossSalePreference: typeof row.lossSalePreference === 'boolean' ? row.lossSalePreference : false,
      });
      return validation.ok ? [validation.value] : [];
    });
    const ids = new Set<string>();
    return valid.map((holding, index) => {
      let id = holding.id;
      while (ids.has(id)) id = `${holding.id}-${index + 1}`;
      ids.add(id);
      return id === holding.id ? holding : { ...holding, id };
    });
  } catch {
    return [];
  }
}

const CSV_HEADERS = ['symbol', 'averageBuyPriceKrw', 'quantity', 'investedPrincipalKrw', 'firstBuyDate', 'recentBuyDate', 'targetDeadline', 'memo', 'lossSalePreference'] as const;

export function exportHoldingsCsv(holdings: Holding[]): string {
  return [CSV_HEADERS.join(','), ...holdings.map((holding) => CSV_HEADERS.map((header) => csvCell(String(holding[header] ?? ''))).join(','))].join('\r\n');
}

export function importHoldingsCsv(csv: string): Holding[] {
  if (new TextEncoder().encode(csv).byteLength > MAX_IMPORT_BYTES) throw new Error('CSV 크기가 허용 한도를 초과했습니다.');
  const rows = parseCsv(csv);
  if (rows.length < 2 || rows[0].join(',') !== CSV_HEADERS.join(',')) throw new Error('CSV 헤더가 올바르지 않습니다.');
  return rows.slice(1).filter((row) => row.some(Boolean)).map((row, index) => {
    if (row.length !== CSV_HEADERS.length) throw new Error(`CSV ${index + 2}행의 열 수가 올바르지 않습니다.`);
    if (row.some(isFormulaCell)) throw new Error(`CSV ${index + 2}행에 formula 수식 셀이 포함되어 있습니다.`);
    const [symbol, averageBuyPriceKrw, quantity, investedPrincipalKrw, firstBuyDate, recentBuyDate, targetDeadline, memo, lossSalePreference] = row;
    if (lossSalePreference !== 'true' && lossSalePreference !== 'false') throw new Error(`CSV ${index + 2}행의 lossSalePreference는 true 또는 false여야 합니다.`);
    const validation = validateHoldingDraft({
      id: `import-${index + 1}`,
      symbol: symbol as AssetSymbol,
      averageBuyPriceKrw: parseOptionalNumber(averageBuyPriceKrw) ?? Number.NaN,
      quantity: parseOptionalNumber(quantity),
      investedPrincipalKrw: parseOptionalNumber(investedPrincipalKrw),
      firstBuyDate: firstBuyDate || null,
      recentBuyDate: recentBuyDate || null,
      targetDeadline: targetDeadline || null,
      memo,
      lossSalePreference: lossSalePreference === 'true',
    });
    if (!validation.ok) throw new Error(`CSV ${index + 2}행이 유효하지 않습니다: ${validation.errors.join(' ')}`);
    return validation.value;
  });
}

export function serializeHoldingsStorage(holdings: Holding[]): string {
  return JSON.stringify({ version: 2, holdings });
}

export function exportHoldingsJson(holdings: Holding[]): string {
  return JSON.stringify({ version: 2, holdings }, null, 2);
}

export function importHoldingsJson(raw: string): Holding[] {
  if (new TextEncoder().encode(raw).byteLength > MAX_IMPORT_BYTES) throw new Error('JSON 크기가 허용 한도를 초과했습니다.');
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('JSON 형식이 올바르지 않습니다.');
  }
  if (!parsed || typeof parsed !== 'object' || !Array.isArray((parsed as { holdings?: unknown }).holdings)) throw new Error('JSON holdings 배열이 필요합니다.');
  const candidates = (parsed as { holdings: unknown[] }).holdings;
  return candidates.map((candidate, index) => {
    if (!candidate || typeof candidate !== 'object') throw new Error(`JSON ${index + 1}번째 보유자산이 유효하지 않습니다.`);
    const row = candidate as Partial<Holding>;
    const validation = validateHoldingDraft({
      id: `import-${index + 1}`,
      symbol: row.symbol as AssetSymbol,
      averageBuyPriceKrw: row.averageBuyPriceKrw as number,
      quantity: row.quantity ?? null,
      investedPrincipalKrw: row.investedPrincipalKrw ?? null,
      firstBuyDate: typeof row.firstBuyDate === 'string' ? row.firstBuyDate : null,
      recentBuyDate: typeof row.recentBuyDate === 'string' ? row.recentBuyDate : null,
      targetDeadline: typeof row.targetDeadline === 'string' ? row.targetDeadline : null,
      memo: typeof row.memo === 'string' ? row.memo : '',
      lossSalePreference: typeof row.lossSalePreference === 'boolean' ? row.lossSalePreference : false,
    });
    if (!validation.ok) throw new Error(`JSON ${index + 1}번째 보유자산이 유효하지 않습니다: ${validation.errors.join(' ')}`);
    return validation.value;
  });
}

export function evaluateHolding(input: {
  holding: Holding;
  market: HoldingMarketSnapshot;
  portfolioValueKrw: number | null;
  additionalBudgetKrw: number | null;
  now: string;
}): HoldingEvaluation {
  const { holding, market } = input;
  const costBasisKrw = holding.quantity !== null ? holding.averageBuyPriceKrw * holding.quantity : holding.investedPrincipalKrw!;
  const rawMarketValueKrw = holding.quantity !== null && market.currentPriceKrw !== null ? holding.quantity * market.currentPriceKrw : null;
  const marketValueKrw = rawMarketValueKrw !== null && Number.isFinite(rawMarketValueKrw) && rawMarketValueKrw <= MAX_KRW ? rawMarketValueKrw : null;
  const returnPercent = market.currentPriceKrw === null ? Number.NaN : ((market.currentPriceKrw - holding.averageBuyPriceKrw) / holding.averageBuyPriceKrw) * 100;
  const profitKrw = marketValueKrw === null ? null : marketValueKrw - costBasisKrw;
  const portfolioWeightPercent = marketValueKrw !== null && input.portfolioValueKrw !== null && input.portfolioValueKrw > 0 ? (marketValueKrw / input.portfolioValueKrw) * 100 : null;
  const reasons: string[] = [];
  const conflicts: string[] = [];
  const checklist: string[] = [];
  const invalidationConditions = ['시그널 snapshot이 stale 또는 결측이면 판단을 무효화합니다.', 'coverage가 100% 미만이면 강한 판단을 무효화합니다.', '다음 닫힌 봉에서 점수·추세 조건이 바뀌면 다시 평가합니다.'];

  const signalBarTime = Date.parse(market.signalBarClose);
  const asOfTime = Date.parse(market.asOf);
  const dataInsufficient = market.currentPriceKrw === null || !isSafePositive(market.currentPriceKrw, MAX_KRW) || (holding.quantity !== null && marketValueKrw === null) || market.stale || !market.extremeEligible || !Number.isFinite(signalBarTime) || !Number.isFinite(asOfTime) || signalBarTime > asOfTime || market.signalTimeframe !== '1d' || market.coverageRegime !== 'full' || market.availableWeight < market.extremeCoverageFloor;
  if (dataInsufficient) {
    reasons.push('현재가·닫힌 1일 봉·feature freshness·100% coverage 중 하나 이상이 확인되지 않았습니다.');
    return result('데이터 부족');
  }

  const deadlineReached = Boolean(holding.targetDeadline && holding.targetDeadline <= input.now.slice(0, 10));
  const concentrated = portfolioWeightPercent !== null && portfolioWeightPercent > CONCENTRATION_PERCENT;
  const sellScore = market.sellThresholdCrossed;
  const trendBroken = market.trendBroken;
  if (sellScore) reasons.push(`닫힌 봉 시장 점수가 강한 매도 임계값(20점 이하)을 하향 통과해 현재 ${market.score}점입니다.`);
  if (trendBroken) reasons.push('닫힌 1일 봉의 추세 확인 조건이 훼손되었습니다.');
  if (deadlineReached) reasons.push('사용자가 입력한 목표기한에 도달했습니다.');
  if (concentrated) reasons.push(`단일 자산 비중이 보수적 집중 기준 ${CONCENTRATION_PERCENT}%를 초과했습니다.`);
  if (sellScore || trendBroken || deadlineReached || concentrated) {
    if (holding.lossSalePreference && returnPercent < 0) conflicts.push('손실 매도 회피 선호와 시장 위험·기한·집중 근거가 충돌합니다. 두 근거를 모두 확인하세요.');
    checklist.push('주문 수량은 자동 제안하지 않으며 세금·수수료·현금 필요를 별도로 확인합니다.');
    return result('비중축소 검토');
  }

  const validAdditionalBudget = input.additionalBudgetKrw !== null && isSafePositive(input.additionalBudgetKrw, MAX_KRW);
  const buyConditions = market.score >= 80 && market.extremeEligible && market.trendConfirmed && validAdditionalBudget;
  if (buyConditions) {
    reasons.push('fresh 100% coverage의 닫힌 1일 봉에서 강한 점수와 추세 조건이 함께 확인되었습니다.');
    checklist.push('추가 투자 가능 금액을 별도로 확인했습니다.', '평균매수가가 아니라 시장 시그널을 우선 확인했습니다.', '자동 주문이나 주문 수량 제안은 제공하지 않습니다.');
    return result('추가매수 검토');
  }

  reasons.push(input.additionalBudgetKrw === null ? '추가 투자 가능 금액이 없어 행동 강도를 낮췄습니다.' : '추가매수 또는 비중축소의 모든 조건이 동시에 충족되지 않았습니다.');
  return result('보유');

  function result(status: HoldingStatus): HoldingEvaluation {
    const confidence = market.backtest && market.backtest.sampleCount >= 30 && market.backtest.outOfSampleValidated ? 'medium' : 'low';
    return { policyVersion: HOLDINGS_POLICY_VERSION, status, confidence, metrics: { costBasisKrw, marketValueKrw, profitKrw, returnPercent, portfolioWeightPercent }, reasons, conflicts, checklist, invalidationConditions };
  }
}

function isSafePositive(value: number, max: number): boolean {
  return Number.isFinite(value) && value > 0 && value <= max;
}

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
}

function parseOptionalNumber(value: string): number | null {
  if (value.trim() === '') return null;
  if (!/^(?:\d+|\d*\.\d+)$/.test(value.trim())) return Number.NaN;
  return Number(value);
}

function isFormulaCell(value: string): boolean {
  return /^[=+\-@]/.test(value.trimStart());
}

function csvCell(value: string): string {
  const safe = isFormulaCell(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

function parseCsv(csv: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  let closedQuote = false;
  for (let index = 0; index < csv.length; index += 1) {
    const char = csv[index];
    if (quoted) {
      if (char === '"' && csv[index + 1] === '"') { cell += '"'; index += 1; }
      else if (char === '"') { quoted = false; closedQuote = true; }
      else cell += char;
    } else if (closedQuote && char !== ',' && char !== '\n' && char !== '\r') throw new Error('CSV 닫는 따옴표 뒤에 잘못된 문자가 있습니다.');
    else if (char === '"' && cell === '') quoted = true;
    else if (char === '"') throw new Error('CSV 따옴표 위치가 올바르지 않습니다.');
    else if (char === ',') { row.push(cell); cell = ''; closedQuote = false; }
    else if (char === '\n') { row.push(cell.replace(/\r$/, '')); rows.push(row); row = []; cell = ''; closedQuote = false; }
    else if (char === '\r' && csv[index + 1] === '\n') continue;
    else cell += char;
  }
  if (quoted) throw new Error('CSV 따옴표가 닫히지 않았습니다.');
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}
