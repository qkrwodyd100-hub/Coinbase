import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { createElement } from 'react';
import HoldingsPanel from '@/app/holdings-panel';
import type { DashboardPayload } from '@/lib/signals';

const payload = {
  asOf: '2026-08-28T00:00:00.000Z',
  signalTimeframe: '1d',
  signalBarClose: '2026-08-28T00:00:00.000Z',
  nextExecutableAt: '2026-08-28T00:00:00.000Z',
  usdKrwRate: 1400,
  fxUnavailable: false,
  assets: [{
    symbol: 'BTC', name: '비트코인', price: 65_000, overallScore: 85, signal: { label: '강력 매수', tone: 'positive' }, stale: false,
    indicators: [{ id: 'moving-averages', title: '이동평균', value: 'x', score: 25, maxScore: 25, interpretation: '상승 정렬' }],
    missingFeatures: [], scorePolicy: 'verified', signalTimeframe: '1d', signalBarOpen: '2026-08-27T00:00:00.000Z', signalBarClose: '2026-08-28T00:00:00.000Z',
    availableWeight: 100, coverageRegime: 'full', extremeEligible: true, extremeCoverageFloor: 100,
    features: [{ id: 'moving-averages', source: 'binance-spot-klines', timeframe: '1d', observedAt: '2026-08-28T00:00:00.000Z', availableAt: '2026-08-28T00:00:00.000Z', maxAgeMs: 300000, status: 'available' }],
  }],
  backtestSummary: { generatedAt: '2026-08-28T00:00:00.000Z', source: 'live', dataLimitations: ['OOS 미검증'], rows: [], reports: [{ asset: 'BTC', interval: '1d', dataStart: '2024-01-01', dataEnd: '2026-08-28', candleCount: 970, evaluatedSignals: 21, excludedSignals: 3, horizon: '7d', lookAheadRule: 'next open' }] },
} satisfies DashboardPayload;

describe('HoldingsPanel', () => {
  afterEach(() => {
    cleanup();
    window.localStorage.clear();
  });

  it('shows a private local-only empty state and no credential inputs', () => {
    render(createElement(HoldingsPanel, { payload }));
    expect(screen.getByRole('heading', { name: '내 보유자산' })).toBeInTheDocument();
    expect(screen.getByText(/이 브라우저에만 저장/)).toBeInTheDocument();
    expect(screen.getByText(/거래소 API key.*요구하지 않습니다/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/api key|secret|지갑|시드|로그인/i)).not.toBeInTheDocument();
    expect(screen.getByText(/아직 등록한 보유자산이 없습니다/)).toBeInTheDocument();
  });

  it('adds a holding, persists it locally, and displays price/PnL/action evidence', async () => {
    const user = userEvent.setup();
    const { unmount } = render(createElement(HoldingsPanel, { payload }));
    await user.type(screen.getByLabelText('평균매수가 KRW'), '70000000');
    await user.type(screen.getByLabelText('수량'), '0.1');
    await user.type(screen.getByLabelText('목표매도기한'), '2028-12-31');
    await user.type(screen.getByLabelText('추가 투자 가능 금액 KRW'), '1000000');
    await user.click(screen.getByRole('button', { name: '보유자산 추가' }));

    const region = screen.getByRole('region', { name: 'BTC 보유자산 판단' });
    expect(region).toHaveTextContent('현재가');
    expect(region).toHaveTextContent('₩91,000,000');
    expect(region).toHaveTextContent('손익');
    expect(region).toHaveTextContent('₩2,100,000');
    expect(region).toHaveTextContent('비중축소 검토');
    expect(region).toHaveTextContent('시장 시그널');
    expect(region).toHaveTextContent('내 손익/비중');
    expect(region).toHaveTextContent('판단 근거');
    expect(region).toHaveTextContent('무효화 조건');
    expect(region).toHaveTextContent('데이터 신뢰도');
    expect(region).toHaveTextContent('holdings-v1');
    expect(region).toHaveTextContent('평가 21건 · 제외 3건');
    expect(region).toHaveTextContent('confidence low');
    expect(window.localStorage.getItem('crypto-signal-dashboard:holdings-v2')).toContain('BTC');

    unmount();
    render(createElement(HoldingsPanel, { payload }));
    expect(screen.getByRole('region', { name: 'BTC 보유자산 판단' })).toBeInTheDocument();
  });

  it('edits and deletes holdings and can clear all local data', async () => {
    window.localStorage.setItem('crypto-signal-dashboard:holdings-v2', JSON.stringify({ version: 2, holdings: [{ id: 'one', symbol: 'BTC', averageBuyPriceKrw: 70_000_000, quantity: 0.1, investedPrincipalKrw: null, firstBuyDate: null, recentBuyDate: null, targetDeadline: null, memo: '', lossSalePreference: false }] }));
    const user = userEvent.setup();
    render(createElement(HoldingsPanel, { payload }));

    const region = screen.getByRole('region', { name: 'BTC 보유자산 판단' });
    await user.click(within(region).getByRole('button', { name: 'BTC 수정' }));
    await user.clear(screen.getByLabelText('평균매수가 KRW'));
    await user.type(screen.getByLabelText('평균매수가 KRW'), '80000000');
    await user.click(screen.getByRole('button', { name: '보유자산 저장' }));
    expect(window.localStorage.getItem('crypto-signal-dashboard:holdings-v2')).toContain('80000000');

    await user.click(within(screen.getByRole('region', { name: 'BTC 보유자산 판단' })).getByRole('button', { name: 'BTC 삭제' }));
    expect(screen.getByText(/아직 등록한 보유자산이 없습니다/)).toBeInTheDocument();

    window.localStorage.setItem('crypto-signal-dashboard:holdings-v2', JSON.stringify({ version: 2, holdings: [] }));
    await user.click(screen.getByRole('button', { name: /모든 보유정보 삭제/ }));
    expect(window.localStorage.getItem('crypto-signal-dashboard:holdings-v2')).toBeNull();
  });

  it('reports data insufficient instead of an action when FX or verified data is unavailable', async () => {
    window.localStorage.setItem('crypto-signal-dashboard:holdings-v2', JSON.stringify({ version: 2, holdings: [{ id: 'one', symbol: 'BTC', averageBuyPriceKrw: 70_000_000, quantity: 0.1, investedPrincipalKrw: null, firstBuyDate: null, recentBuyDate: null, targetDeadline: null, memo: '', lossSalePreference: false }] }));
    render(createElement(HoldingsPanel, { payload: { ...payload, usdKrwRate: null, fxUnavailable: true } }));
    expect(screen.getByRole('region', { name: 'BTC 보유자산 판단' })).toHaveTextContent('데이터 부족');
  });

  it('preserves valid holdings when unrelated settings storage is corrupt', () => {
    window.localStorage.setItem('crypto-signal-dashboard:holdings-v2', JSON.stringify({ version: 2, holdings: [{ id: 'one', symbol: 'BTC', averageBuyPriceKrw: 70_000_000, quantity: 0.1, investedPrincipalKrw: null, firstBuyDate: null, recentBuyDate: null, targetDeadline: null, memo: '', lossSalePreference: false }] }));
    window.localStorage.setItem('crypto-signal-dashboard:holdings-settings-v1', '{bad json');
    render(createElement(HoldingsPanel, { payload }));
    expect(screen.getByRole('region', { name: 'BTC 보유자산 판단' })).toBeInTheDocument();
  });
});
