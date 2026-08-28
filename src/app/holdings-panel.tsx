'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  HOLDINGS_POLICY_VERSION,
  HOLDINGS_STORAGE_KEY,
  evaluateHolding,
  exportHoldingsCsv,
  exportHoldingsJson,
  importHoldingsCsv,
  importHoldingsJson,
  parseHoldingsStorage,
  serializeHoldingsStorage,
  validateHoldingDraft,
  type Holding,
  type HoldingDraft,
  type HoldingMarketSnapshot,
} from '@/lib/holdings';
import { ASSET_SYMBOLS, formatKrw, type AssetSignal, type AssetSymbol, type DashboardPayload } from '@/lib/signals';

const SETTINGS_STORAGE_KEY = 'crypto-signal-dashboard:holdings-settings-v1';
const SCORE_HISTORY_STORAGE_KEY = 'crypto-signal-dashboard:holdings-score-history-v1';
type ScoreHistory = Record<string, { score: number; barClose: string; lastSellCrossBar: string | null }>;

type FormState = {
  symbol: AssetSymbol;
  averageBuyPriceKrw: string;
  quantity: string;
  investedPrincipalKrw: string;
  firstBuyDate: string;
  recentBuyDate: string;
  targetDeadline: string;
  memo: string;
  lossSalePreference: boolean;
};

const EMPTY_FORM: FormState = {
  symbol: 'BTC', averageBuyPriceKrw: '', quantity: '', investedPrincipalKrw: '', firstBuyDate: '', recentBuyDate: '', targetDeadline: '', memo: '', lossSalePreference: false,
};

export default function HoldingsPanel({ payload }: { payload: DashboardPayload | null }) {
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [additionalBudget, setAdditionalBudget] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [sort, setSort] = useState<'symbol' | 'weight' | 'return'>('symbol');
  const [scoreHistory, setScoreHistory] = useState<ScoreHistory>({});
  const skipPersistenceRef = useRef(false);
  const importRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    try {
      setHoldings(parseHoldingsStorage(window.localStorage.getItem(HOLDINGS_STORAGE_KEY)));
    } catch {
      setHoldings([]);
    }
    try {
      const settings = JSON.parse(window.localStorage.getItem(SETTINGS_STORAGE_KEY) ?? '{}') as { additionalBudgetKrw?: unknown };
      if (typeof settings.additionalBudgetKrw === 'number' && Number.isFinite(settings.additionalBudgetKrw) && settings.additionalBudgetKrw >= 0) setAdditionalBudget(String(settings.additionalBudgetKrw));
    } catch {
      setAdditionalBudget('');
    }
    try {
      const storedScores = JSON.parse(window.localStorage.getItem(SCORE_HISTORY_STORAGE_KEY) ?? '{}') as unknown;
      if (storedScores && typeof storedScores === 'object' && !Array.isArray(storedScores)) setScoreHistory(storedScores as ScoreHistory);
    } catch { setScoreHistory({}); }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated || !payload) return;
    setScoreHistory((current) => {
      const next = { ...current };
      for (const asset of payload.assets) {
        const previous = current[asset.symbol];
        if (previous?.barClose === asset.signalBarClose) continue;
        const crossed = Boolean(previous && previous.score > 20 && asset.overallScore <= 20);
        next[asset.symbol] = { score: asset.overallScore, barClose: asset.signalBarClose, lastSellCrossBar: crossed ? asset.signalBarClose : (previous?.lastSellCrossBar ?? null) };
      }
      try { window.localStorage.setItem(SCORE_HISTORY_STORAGE_KEY, JSON.stringify(next)); } catch { /* current session still works */ }
      return next;
    });
  }, [hydrated, payload]);

  useEffect(() => {
    if (!hydrated) return;
    if (skipPersistenceRef.current) { skipPersistenceRef.current = false; return; }
    try { window.localStorage.setItem(HOLDINGS_STORAGE_KEY, serializeHoldingsStorage(holdings)); } catch { /* current session still works */ }
  }, [holdings, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    const parsed = parseSafeBudget(additionalBudget);
    try {
      if (parsed === null) window.localStorage.removeItem(SETTINGS_STORAGE_KEY);
      else window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify({ additionalBudgetKrw: parsed }));
    } catch { /* current session still works */ }
  }, [additionalBudget, hydrated]);

  const cards = useMemo(() => buildCards(holdings, payload, parseSafeBudget(additionalBudget), scoreHistory), [holdings, payload, additionalBudget, scoreHistory]);
  const sortedCards = useMemo(() => [...cards].sort((a, b) => {
    if (sort === 'weight') return (b.evaluation.metrics.portfolioWeightPercent ?? -1) - (a.evaluation.metrics.portfolioWeightPercent ?? -1);
    if (sort === 'return') return finiteOrLow(b.evaluation.metrics.returnPercent) - finiteOrLow(a.evaluation.metrics.returnPercent);
    return a.holding.symbol.localeCompare(b.holding.symbol);
  }), [cards, sort]);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (additionalBudget.trim() !== '' && parseSafeBudget(additionalBudget) === null) {
      setMessage('추가 투자 가능 금액은 0원 이상 1,000조원 이하의 유한한 숫자여야 합니다.');
      return;
    }
    const candidate = formToDraft(form, editingId ?? undefined);
    const validation = validateHoldingDraft(candidate);
    if (!validation.ok) { setMessage(validation.errors.join(' ')); return; }
    const next = editingId ? holdings.map((holding) => holding.id === editingId ? validation.value : holding) : [...holdings, { ...validation.value, id: uniqueId(validation.value.symbol) }];
    setHoldings(next);
    setMessage(validation.warnings[0] ?? (editingId ? '보유자산을 수정했습니다.' : '보유자산을 추가했습니다.'));
    setEditingId(null);
    setForm(EMPTY_FORM);
  };

  const edit = (holding: Holding) => {
    setEditingId(holding.id);
    setForm({
      symbol: holding.symbol,
      averageBuyPriceKrw: String(holding.averageBuyPriceKrw),
      quantity: holding.quantity === null ? '' : String(holding.quantity),
      investedPrincipalKrw: holding.investedPrincipalKrw === null ? '' : String(holding.investedPrincipalKrw),
      firstBuyDate: holding.firstBuyDate ?? '', recentBuyDate: holding.recentBuyDate ?? '', targetDeadline: holding.targetDeadline ?? '', memo: holding.memo, lossSalePreference: holding.lossSalePreference,
    });
  };

  const clearAll = () => {
    skipPersistenceRef.current = true;
    setHoldings([]);
    setAdditionalBudget('');
    setEditingId(null);
    setForm(EMPTY_FORM);
    try {
      window.localStorage.removeItem(HOLDINGS_STORAGE_KEY);
      window.localStorage.removeItem(SETTINGS_STORAGE_KEY);
      window.localStorage.removeItem(SCORE_HISTORY_STORAGE_KEY);
    } catch { /* no-op */ }
    setMessage('이 브라우저의 모든 보유정보를 삭제했습니다.');
  };

  const handleImport = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const imported = file.name.toLowerCase().endsWith('.json') ? importHoldingsJson(text) : importHoldingsCsv(text);
      setHoldings(imported.map((holding) => ({ ...holding, id: uniqueId(holding.symbol) })));
      setMessage(`${imported.length}개 보유자산을 가져왔습니다.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '파일을 가져오지 못했습니다.');
    } finally {
      event.target.value = '';
    }
  };

  return (
    <section className="space-y-5" aria-labelledby="holdings-title">
      <header className="rounded-[2rem] border border-cyan-200/20 bg-cyan-200/[0.07] p-5 sm:p-7">
        <p className="text-xs font-bold uppercase tracking-[0.24em] text-cyan-200/70">Local-only portfolio</p>
        <h2 id="holdings-title" className="mt-2 text-3xl font-black">내 보유자산</h2>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-300">입력값은 이 브라우저에만 저장되며 서버·분석·Slack으로 전송하지 않습니다. 거래소 API key, secret, 지갑 주소, 시드문구, 로그인정보를 요구하지 않습니다.</p>
      </header>

      <form onSubmit={submit} className="rounded-[2rem] border border-white/10 bg-white/[0.06] p-5 sm:p-7" aria-label="보유자산 입력">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="자산"><select aria-label="자산" value={form.symbol} onChange={(event) => setForm({ ...form, symbol: event.target.value as AssetSymbol })} className={inputClass}>{ASSET_SYMBOLS.map((symbol) => <option key={symbol}>{symbol}</option>)}</select></Field>
          <Field label="평균매수가 KRW *"><input aria-label="평균매수가 KRW" inputMode="decimal" value={form.averageBuyPriceKrw} onChange={(event) => setForm({ ...form, averageBuyPriceKrw: event.target.value })} className={inputClass} /></Field>
          <Field label="수량 (선택)"><input aria-label="수량" inputMode="decimal" value={form.quantity} onChange={(event) => setForm({ ...form, quantity: event.target.value })} className={inputClass} /></Field>
          <Field label="총투자원금 KRW (수량 대신 선택)"><input aria-label="총투자원금 KRW" inputMode="decimal" value={form.investedPrincipalKrw} onChange={(event) => setForm({ ...form, investedPrincipalKrw: event.target.value })} className={inputClass} /></Field>
          <Field label="최초 매수일 (선택)"><input aria-label="최초 매수일" type="date" value={form.firstBuyDate} onChange={(event) => setForm({ ...form, firstBuyDate: event.target.value })} className={inputClass} /></Field>
          <Field label="최근 매수일 (선택)"><input aria-label="최근 매수일" type="date" value={form.recentBuyDate} onChange={(event) => setForm({ ...form, recentBuyDate: event.target.value })} className={inputClass} /></Field>
          <Field label="목표매도기한 (선택)"><input aria-label="목표매도기한" type="date" value={form.targetDeadline} onChange={(event) => setForm({ ...form, targetDeadline: event.target.value })} className={inputClass} /></Field>
          <Field label="추가 투자 가능 금액 KRW (전체)"><input aria-label="추가 투자 가능 금액 KRW" inputMode="decimal" value={additionalBudget} onChange={(event) => setAdditionalBudget(event.target.value)} className={inputClass} /></Field>
          <Field label="메모 (선택)"><input aria-label="메모" maxLength={500} value={form.memo} onChange={(event) => setForm({ ...form, memo: event.target.value })} className={inputClass} /></Field>
        </div>
        <label className="mt-4 flex min-h-11 items-center gap-3 text-sm text-slate-200"><input type="checkbox" checked={form.lossSalePreference} onChange={(event) => setForm({ ...form, lossSalePreference: event.target.checked })} /> 손실 매도 회피는 희망값이며 위험 신호를 숨기지 않습니다.</label>
        {message ? <p role="status" className="mt-3 rounded-2xl border border-amber-200/30 bg-amber-200/10 p-3 text-sm text-amber-100">{message}</p> : null}
        <div className="mt-5 flex flex-wrap gap-3">
          <button type="submit" className={primaryButton}>{editingId ? '보유자산 저장' : '보유자산 추가'}</button>
          {editingId ? <button type="button" onClick={() => { setEditingId(null); setForm(EMPTY_FORM); }} className={secondaryButton}>수정 취소</button> : null}
        </div>
      </form>

      <section className="rounded-[2rem] border border-white/10 bg-white/[0.05] p-5" aria-label="보유정보 관리">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => download('holdings.csv', exportHoldingsCsv(holdings), 'text/csv')} className={secondaryButton}>⇩ CSV 내보내기</button>
            <button type="button" onClick={() => download('holdings.json', exportHoldingsJson(holdings), 'application/json')} className={secondaryButton}>⇩ JSON 내보내기</button>
            <button type="button" onClick={() => importRef.current?.click()} className={secondaryButton}>⇧ JSON/CSV 가져오기</button>
            <input ref={importRef} aria-label="JSON/CSV 파일 선택" className="sr-only" type="file" accept=".json,.csv,application/json,text/csv" onChange={(event) => void handleImport(event)} />
          </div>
          <button type="button" onClick={clearAll} className="min-h-11 rounded-2xl border border-rose-300/30 px-4 text-sm font-bold text-rose-100">🗑 모든 보유정보 삭제</button>
        </div>
      </section>

      <div className="flex justify-end"><label className="text-sm text-slate-300">정렬 <select aria-label="보유자산 정렬" value={sort} onChange={(event) => setSort(event.target.value as typeof sort)} className="ml-2 rounded-xl bg-slate-900 p-2"><option value="symbol">자산</option><option value="weight">비중</option><option value="return">수익률</option></select></label></div>

      {sortedCards.length === 0 ? (
        <section className="rounded-[2rem] border border-dashed border-white/20 bg-white/[0.04] p-8 text-center"><h3 className="text-xl font-black">아직 등록한 보유자산이 없습니다.</h3><p className="mt-2 text-sm text-slate-400">예: BTC의 평균매수가와 수량 또는 총투자원금을 입력하면 현재가·손익·규칙 기반 참고 상태를 표시합니다.</p></section>
      ) : <>
        <DesktopHoldingsTable cards={sortedCards} onEdit={edit} onDelete={(id) => setHoldings((current) => current.filter((holding) => holding.id !== id))} />
        <div className="grid gap-4">{sortedCards.map((card) => <HoldingCard key={card.holding.id} {...card} onEdit={edit} onDelete={(id) => setHoldings((current) => current.filter((holding) => holding.id !== id))} />)}</div>
      </>}

      <section className="rounded-[2rem] border border-amber-200/30 bg-amber-200/10 p-5 text-sm leading-6 text-amber-50" aria-labelledby="policy-title">
        <h3 id="policy-title" className="text-lg font-black">판단 기준</h3>
        <p className="mt-2">{HOLDINGS_POLICY_VERSION}: 이 신호는 자동 주문이나 개인 맞춤 투자자문이 아니라 검증된 닫힌 봉 규칙을 포지션 정보와 분리해 보여주는 참고 정보입니다. 손실 가능성이 있으며 수익을 보장하지 않습니다.</p>
        <ul className="mt-3 list-disc space-y-1 pl-5"><li>stale·결측·100% 미만 coverage는 데이터 부족으로 fail-closed</li><li>강한 점수만으로 물타기하지 않고 추세·닫힌 봉·추가 투자 여력을 함께 확인</li><li>매도 임계값, 추세 훼손, 기한, 집중을 서로 다른 근거로 표시</li><li>보수적 단일 자산 집중 기준은 50% 초과이며 주문 수량은 자동 제안하지 않음</li></ul>
      </section>
    </section>
  );
}

function DesktopHoldingsTable({ cards, onEdit, onDelete }: { cards: ReturnType<typeof buildCards>; onEdit: (holding: Holding) => void; onDelete: (id: string) => void }) {
  return (
    <div className="hidden overflow-x-auto rounded-[2rem] border border-white/10 bg-white/[0.05] lg:block">
      <table className="w-full min-w-[900px] text-left text-sm" aria-label="내 보유자산 데스크톱 표">
        <thead className="bg-slate-950/50 text-slate-400"><tr><th className="p-4">자산</th><th className="p-4">현재가</th><th className="p-4">평균매수가</th><th className="p-4">손익</th><th className="p-4">비중</th><th className="p-4">참고 상태</th><th className="p-4">관리</th></tr></thead>
        <tbody>{cards.map(({ holding, market, evaluation }) => <tr key={holding.id} className="border-t border-white/10"><th className="p-4 text-lg text-slate-50">{holding.symbol}</th><td className="p-4">{formatNullableKrw(market.currentPriceKrw)}</td><td className="p-4">{formatKrw(holding.averageBuyPriceKrw)}</td><td className="p-4">{evaluation.metrics.profitKrw === null ? formatPercent(evaluation.metrics.returnPercent) : `${formatKrw(evaluation.metrics.profitKrw)} · ${formatPercent(evaluation.metrics.returnPercent)}`}</td><td className="p-4">{evaluation.metrics.portfolioWeightPercent === null ? '수량 필요' : formatPercent(evaluation.metrics.portfolioWeightPercent)}</td><td className="p-4 font-black">{evaluation.status}</td><td className="p-4"><div className="flex gap-2"><button type="button" aria-label={`${holding.symbol} 표에서 수정`} onClick={() => onEdit(holding)} className={secondaryButton}>✎ 수정</button><button type="button" aria-label={`${holding.symbol} 표에서 삭제`} onClick={() => onDelete(holding.id)} className={secondaryButton}>🗑 삭제</button></div></td></tr>)}</tbody>
      </table>
    </div>
  );
}

function HoldingCard({ holding, asset, evaluation, market, onEdit, onDelete }: ReturnType<typeof buildCards>[number] & { onEdit: (holding: Holding) => void; onDelete: (id: string) => void }) {
  const statusIcon = evaluation.status === '추가매수 검토' ? '＋' : evaluation.status === '비중축소 검토' ? '−' : evaluation.status === '데이터 부족' ? '!' : '●';
  return (
    <article role="region" aria-label={`${holding.symbol} 보유자산 판단`} className="rounded-[2rem] border border-white/10 bg-white/[0.07] p-5 sm:p-7">
      <div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-sm text-slate-400">{asset?.name ?? holding.symbol}</p><h3 className="text-2xl font-black">{holding.symbol}</h3></div><div className="text-right"><p className="text-xs text-slate-400">규칙 기반 참고 상태</p><p className="mt-1 text-lg font-black"><span aria-hidden="true">{statusIcon} </span>{evaluation.status}</p></div></div>
      <dl className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Metric label="현재가" value={market.currentPriceKrw === null ? '확인 불가' : formatKrw(market.currentPriceKrw)} />
        <Metric label="평균매수가" value={formatKrw(holding.averageBuyPriceKrw)} />
        <Metric label="평가금액" value={formatNullableKrw(evaluation.metrics.marketValueKrw)} />
        <Metric label="손익" value={evaluation.metrics.profitKrw === null ? `${formatPercent(evaluation.metrics.returnPercent)} (수량 미입력)` : `${formatKrw(evaluation.metrics.profitKrw)} · ${formatPercent(evaluation.metrics.returnPercent)}`} />
        <Metric label="포트폴리오 비중" value={evaluation.metrics.portfolioWeightPercent === null ? '수량 필요' : formatPercent(evaluation.metrics.portfolioWeightPercent)} />
      </dl>
      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <Evidence title="시장 시그널" body={`${market.signalLabel} · ${market.score}점 · threshold 거리 ${market.score >= 80 ? market.score - 80 : market.score <= 20 ? 20 - market.score : Math.min(80 - market.score, market.score - 20)}점 · ${market.signalTimeframe} 닫힌 봉 ${market.signalBarClose || '결측'}`} />
        <Evidence title="내 손익/비중" body={`수익률 ${formatPercent(evaluation.metrics.returnPercent)} · 비중 ${evaluation.metrics.portfolioWeightPercent === null ? '계산 불가' : formatPercent(evaluation.metrics.portfolioWeightPercent)} · cost basis는 손익 표시에만 사용`} />
        <Evidence title="판단 근거" body={[...evaluation.reasons, ...evaluation.conflicts, ...evaluation.checklist].join(' ')} />
        <Evidence title="무효화 조건" body={evaluation.invalidationConditions.join(' ')} />
        <Evidence title="데이터 신뢰도" body={`${HOLDINGS_POLICY_VERSION} · coverage ${market.availableWeight}/${market.extremeCoverageFloor} ${market.coverageRegime} · freshness ${market.stale ? 'stale' : 'fresh'} · features ${asset?.features.map((feature) => `${feature.id}:${feature.status}@${feature.observedAt ?? 'missing'}`).join(', ') || 'missing'} · ${market.backtest ? `표본 ${market.backtest.sampleCount}건 · 평가 ${market.backtest.evaluated}건 · 제외 ${market.backtest.excluded}건` : '백테스트 없음'} · confidence ${evaluation.confidence}`} />
      </div>
      {holding.memo ? <p className="mt-4 break-words text-sm text-slate-400">메모: {holding.memo}</p> : null}
      <div className="mt-5 flex gap-2"><button type="button" aria-label={`${holding.symbol} 수정`} onClick={() => onEdit(holding)} className={secondaryButton}>✎ 수정</button><button type="button" aria-label={`${holding.symbol} 삭제`} onClick={() => onDelete(holding.id)} className={secondaryButton}>🗑 삭제</button></div>
    </article>
  );
}

function buildCards(holdings: Holding[], payload: DashboardPayload | null, additionalBudgetKrw: number | null, scoreHistory: ScoreHistory) {
  const snapshots = holdings.map((holding) => ({ holding, asset: payload?.assets.find((asset) => asset.symbol === holding.symbol) ?? null }));
  const values = snapshots.map(({ holding, asset }) => holding.quantity !== null && asset && payload?.usdKrwRate ? holding.quantity * asset.price * payload.usdKrwRate : null);
  const portfolioValueKrw = values.every((value) => value !== null) && values.length > 0 ? values.reduce<number>((sum, value) => sum + (value ?? 0), 0) : null;
  return snapshots.map(({ holding, asset }) => {
    const market = marketSnapshot(asset, payload, asset ? scoreHistory[asset.symbol] : undefined);
    return { holding, asset, market, evaluation: evaluateHolding({ holding, market, portfolioValueKrw, additionalBudgetKrw, now: payload?.asOf ?? new Date(0).toISOString() }) };
  });
}

function marketSnapshot(asset: AssetSignal | null, payload: DashboardPayload | null, scoreState?: ScoreHistory[string]): HoldingMarketSnapshot {
  const report = payload?.backtestSummary?.reports.find((item) => item.asset === asset?.symbol && item.interval === '1d');
  const trend = asset?.indicators.find((indicator) => indicator.id === 'moving-averages');
  return {
    currentPriceKrw: asset && payload?.usdKrwRate ? asset.price * payload.usdKrwRate : null,
    asOf: payload?.asOf ?? '', signalBarClose: asset?.signalBarClose ?? '', signalTimeframe: asset?.signalTimeframe ?? '1d', score: asset?.overallScore ?? 0,
    signalLabel: asset?.signal.label ?? '관망', extremeEligible: asset?.extremeEligible ?? false, coverageRegime: asset?.coverageRegime ?? 'insufficient', availableWeight: asset?.availableWeight ?? 0,
    extremeCoverageFloor: asset?.extremeCoverageFloor ?? 100, stale: !asset || asset.stale || Boolean(payload?.fxUnavailable), trendConfirmed: Boolean(trend && trend.score / trend.maxScore >= 0.8), trendBroken: Boolean(trend && trend.score === 0), sellThresholdCrossed: Boolean(asset && scoreState?.lastSellCrossBar === asset.signalBarClose),
    backtest: report ? { sampleCount: report.candleCount, evaluated: report.evaluatedSignals, excluded: report.excludedSignals, outOfSampleValidated: false } : null,
  };
}

function formToDraft(form: FormState, id?: string): HoldingDraft {
  return { id, symbol: form.symbol, averageBuyPriceKrw: parseNumber(form.averageBuyPriceKrw) ?? Number.NaN, quantity: parseNumber(form.quantity), investedPrincipalKrw: parseNumber(form.investedPrincipalKrw), firstBuyDate: form.firstBuyDate || null, recentBuyDate: form.recentBuyDate || null, targetDeadline: form.targetDeadline || null, memo: form.memo, lossSalePreference: form.lossSalePreference };
}

function parseNumber(value: string): number | null { const trimmed = value.trim(); return trimmed === '' ? null : Number(trimmed); }
function parseSafeBudget(value: string): number | null { const parsed = parseNumber(value); return parsed !== null && Number.isFinite(parsed) && parsed >= 0 && parsed <= 1_000_000_000_000_000 ? parsed : null; }
function uniqueId(symbol: AssetSymbol): string { return `${symbol.toLowerCase()}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`; }
function finiteOrLow(value: number): number { return Number.isFinite(value) ? value : -Number.MAX_VALUE; }
function formatNullableKrw(value: number | null): string { return value === null ? '수량 필요' : formatKrw(value); }
function formatPercent(value: number): string { return Number.isFinite(value) ? `${value >= 0 ? '+' : ''}${value.toFixed(2)}%` : '계산 불가'; }
function download(name: string, content: string, type: string) { const url = URL.createObjectURL(new Blob([content], { type })); const link = document.createElement('a'); link.href = url; link.download = name; link.click(); URL.revokeObjectURL(url); }
function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="text-sm font-semibold text-slate-300">{label}{children}</label>; }
function Metric({ label, value }: { label: string; value: string }) { return <div className="rounded-2xl bg-slate-950/40 p-4"><dt className="text-xs text-slate-400">{label}</dt><dd className="mt-1 break-words font-black text-slate-50">{value}</dd></div>; }
function Evidence({ title, body }: { title: string; body: string }) { return <section className="rounded-2xl border border-white/10 bg-slate-950/30 p-4"><h4 className="font-black text-cyan-100">{title}</h4><p className="mt-2 text-sm leading-6 text-slate-300">{body}</p></section>; }
const inputClass = 'mt-2 min-h-11 w-full rounded-2xl border border-white/10 bg-slate-950/60 px-4 text-slate-50 outline-none focus:ring-2 focus:ring-cyan-200/80';
const primaryButton = 'min-h-11 rounded-2xl bg-cyan-300 px-5 text-sm font-black text-slate-950';
const secondaryButton = 'min-h-11 rounded-2xl border border-white/15 bg-white/[0.06] px-4 text-sm font-bold text-slate-100';
