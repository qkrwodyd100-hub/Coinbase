import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { act, createElement } from 'react';
import Home from '@/app/page';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });

  return { promise, resolve };
}

const closedSignalContract = {
  signalTimeframe: '1d' as const,
  signalBarOpen: '2026-08-04T00:00:00.000Z',
  signalBarClose: '2026-08-05T00:00:00.000Z',
  availableWeight: 100,
  coverageRegime: 'full' as const,
  extremeEligible: true,
  extremeCoverageFloor: 100,
  features: [
    { id: 'moving-averages' as const, source: 'binance-spot-klines', timeframe: '1d' as const, observedAt: '2026-08-05T00:00:00.000Z', availableAt: '2026-08-05T00:00:00.000Z', maxAgeMs: 300_000, status: 'available' as const },
    { id: 'funding' as const, source: 'binance-usdm-funding', timeframe: '8h' as const, observedAt: '2026-08-04T16:00:00.000Z', availableAt: '2026-08-04T16:00:00.000Z', maxAgeMs: 43_200_000, status: 'available' as const },
  ],
};

const okPayload = {
  asOf: '2026-08-05T00:00:00.000Z',
  signalTimeframe: '1d' as const,
  signalBarClose: '2026-08-05T00:00:00.000Z',
  nextExecutableAt: '2026-08-05T00:00:00.000Z',
  usdKrwRate: 1370,
  fxUnavailable: false,
  assets: [
    {
      ...closedSignalContract,
      symbol: 'BTC',
      name: '비트코인',
      price: 65000,
      overallScore: 85,
      signal: { label: '강력 매수', tone: 'positive' },
      stale: false,
      indicators: [
        { id: 'rsi', title: 'RSI (14)', value: '28.00', score: 30, maxScore: 30, interpretation: '과매도 구간은 RSI 점수를 가장 높게 반영합니다.' },
        { id: 'fear-greed', title: '공포·탐욕 지수', value: '22', score: 20, maxScore: 20, interpretation: '극단적 공포는 역발상 매집 구간일 수 있습니다.' },
        {
          id: 'moving-averages',
          title: '이동평균',
          value: '$65,000 · ₩89,050,000 / MA20 $63,000 · ₩86,310,000 / MA50 $61,000 · ₩83,570,000',
          score: 25,
          maxScore: 25,
          interpretation: '가격이 두 이동평균 위에 있고 단기 추세가 앞서고 있습니다.',
        },
        { id: 'futures-positioning', title: '선물 펀딩비·미체결약정', value: '-0.0010% / OI 2.00%', score: 20, maxScore: 20, interpretation: '음수 또는 중립 펀딩은 과열된 롱 레버리지를 피합니다.' },
      ],
    },
    {
      ...closedSignalContract,
      symbol: 'ETH',
      name: '이더리움',
      price: 3200,
      overallScore: 55,
      signal: { label: '관망', tone: 'neutral' },
      stale: false,
      indicators: [
        { id: 'rsi', title: 'RSI (14)', value: '52.00', score: 15, maxScore: 30, interpretation: '중간 범위의 모멘텀은 건설적이지만 큰 할인 구간은 아닙니다.' },
        { id: 'fear-greed', title: '공포·탐욕 지수', value: '50', score: 10, maxScore: 20, interpretation: '균형 잡힌 심리는 중간 점수를 받습니다.' },
        {
          id: 'moving-averages',
          title: '이동평균',
          value: '$3,200 · ₩4,384,000 / MA20 $3,100 · ₩4,247,000 / MA50 $3,250 · ₩4,452,500',
          score: 15,
          maxScore: 25,
          interpretation: '가격은 MA20 위에 있지만 추세 확인은 엇갈립니다.',
        },
        { id: 'futures-positioning', title: '선물 펀딩비·미체결약정', value: '0.0200% / OI -1.00%', score: 10, maxScore: 20, interpretation: '중간 양수 펀딩은 선물 점수를 낮춥니다.' },
      ],
    },
  ],
};

describe('dashboard behavior', () => {
  afterEach(() => {
    cleanup();
    window.localStorage.clear();
    vi.restoreAllMocks();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('switches between the market dashboard and the separate 내 보유자산 tab without losing market data', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => okPayload }));
    render(createElement(Home));
    await screen.findByRole('heading', { name: /비트코인 시그널/i });

    const navigation = screen.getByRole('tablist', { name: '대시보드 보기' });
    expect(within(navigation).getByRole('tab', { name: '시장 시그널' })).toHaveAttribute('aria-selected', 'true');
    await userEvent.click(within(navigation).getByRole('tab', { name: '내 보유자산' }));

    expect(screen.getByRole('heading', { name: '내 보유자산' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /비트코인 시그널/i })).not.toBeInTheDocument();
    await userEvent.click(within(navigation).getByRole('tab', { name: '시장 시그널' }));
    expect(screen.getByRole('heading', { name: /비트코인 시그널/i })).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledTimes(1);

    within(navigation).getByRole('tab', { name: '시장 시그널' }).focus();
    await userEvent.keyboard('{ArrowRight}');
    await waitFor(() => expect(within(navigation).getByRole('tab', { name: '내 보유자산' })).toHaveFocus());
    expect(screen.getByRole('tabpanel', { name: '내 보유자산' })).toBeInTheDocument();
  });

  it('renders Korean BTC data with computed KRW prices and lets users switch to ETH', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => okPayload }));

    render(createElement(Home));

    expect(await screen.findByRole('heading', { name: /비트코인 시그널/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '크립토 시그널 대시보드' })).toBeInTheDocument();
    expect(screen.getAllByText('$65,000 · ₩89,050,000').length).toBeGreaterThan(0);
    expect(screen.getAllByText('강력 매수').length).toBeGreaterThan(0);
    expect(screen.getByRole('heading', { name: '선물 펀딩비·미체결약정' })).toBeInTheDocument();
    const bitcoinMeter = screen.getByRole('meter', { name: /비트코인 시그널 점수/i });
    expect(bitcoinMeter).toHaveAttribute('aria-valuenow', '85');
    expect(bitcoinMeter.querySelector('circle.stroke-emerald-300')).toBeInTheDocument();
    expect(within(bitcoinMeter).getByText('강력 매수')).toHaveClass('text-emerald-100');

    const movingAveragePrices = screen.getByRole('list', { name: '이동평균 가격' });
    expect(within(movingAveragePrices).getAllByRole('listitem')).toHaveLength(3);
    expect(within(movingAveragePrices).getByText('현재가 $65,000 · ₩89,050,000')).toBeInTheDocument();
    expect(within(movingAveragePrices).getByText('MA20 $63,000 · ₩86,310,000')).toBeInTheDocument();
    expect(within(movingAveragePrices).getByText('MA50 $61,000 · ₩83,570,000')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('tab', { name: /eth.*이더리움/i }));

    expect(screen.getByRole('heading', { name: /이더리움 시그널/i })).toBeInTheDocument();
    expect(screen.getAllByText('$3,200 · ₩4,384,000').length).toBeGreaterThan(0);
    expect(screen.getAllByText('관망').length).toBeGreaterThan(0);
    const ethereumMeter = screen.getByRole('meter', { name: /이더리움 시그널 점수/i });
    expect(ethereumMeter.querySelector('circle.stroke-amber-300')).toBeInTheDocument();
    expect(within(ethereumMeter).getByText('관망')).toHaveClass('text-amber-100');
  });

  it('keeps all eight asset choices in a compact horizontal tab strip and switches to SHIB', async () => {
    const altSymbols = ['SHIB', 'FIL', 'STX', 'DOGE', 'ARB', 'XRP'] as const;
    const allAssets = [
      ...okPayload.assets,
      ...altSymbols.map((symbol, index) => ({
        ...okPayload.assets[0],
        symbol,
        name: `${symbol} 코인`,
        price: index === 0 ? 0.00001234 : index + 1,
        overallScore: 60 + index,
        signal: { label: '매수' as const, tone: 'positive' as const },
        indicators: [{ id: 'alt-btc-strength' as const, title: 'ALT/BTC 상대강도', value: '0.00000012 / MA20 0.00000010', score: 15, maxScore: 15, interpretation: 'BTC 대비 강세입니다.' }],
      })),
    ];
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ...okPayload, assets: allAssets }) }));

    render(createElement(Home));

    const tablist = await screen.findByRole('tablist', { name: '자산 탭 목록' });
    expect(within(tablist).getAllByRole('tab')).toHaveLength(8);
    expect(tablist).toHaveClass('overflow-x-auto');
    for (const asset of allAssets) {
      await userEvent.click(within(tablist).getByRole('tab', { name: new RegExp(`${asset.symbol}.*${asset.name}`, 'i') }));
      expect(screen.getByRole('heading', { name: `${asset.name} 시그널` })).toBeInTheDocument();
      expect(screen.getByRole('meter', { name: new RegExp(`${asset.name} 시그널 점수`, 'i') })).toHaveAttribute('aria-valuenow', String(asset.overallScore));
      const contract = screen.getByRole('region', { name: `${asset.symbol} 시그널 데이터 계약` });
      expect(contract).toHaveTextContent('1d 닫힌 봉');
      expect(contract).toHaveTextContent('2026-08-05T00:00:00.000Z');
      expect(contract).toHaveTextContent('full · 100/100');
    }
    expect(screen.getByRole('button', { name: /ALT\/BTC 상대강도.*상세 설명 열기/i })).toBeInTheDocument();
  });

  it('opens accessible indicator details by pointer and closes with Escape while restoring focus', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => okPayload }));

    render(createElement(Home));
    await screen.findByRole('heading', { name: /비트코인 시그널/i });

    const rsiCard = screen.getByRole('button', { name: /RSI \(14\).*28\.00.*30\/30/i });
    await userEvent.click(rsiCard);

    const dialog = screen.getByRole('dialog', { name: 'RSI (14) 상세 설명' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveTextContent('무엇을 보는 지표인가요?');
    expect(dialog).toHaveTextContent('현재 대시보드 계산 방식');
    expect(dialog).toHaveTextContent('현재 값과 배점');
    expect(dialog).toHaveTextContent('28.00');
    expect(dialog).toHaveTextContent('30/30점');
    expect(dialog).toHaveTextContent('보조지표이며 단독 매수·매도 판단 근거가 아닙니다.');

    await userEvent.keyboard('{Escape}');

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(rsiCard).toHaveFocus());
  });

  it('opens indicator details with keyboard and resets stale detail content after switching assets', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => okPayload }));

    render(createElement(Home));
    await screen.findByRole('heading', { name: /비트코인 시그널/i });

    const futuresCard = screen.getByRole('button', { name: /선물 펀딩비·미체결약정.*-0\.0010%.*20\/20/i });
    futuresCard.focus();
    await userEvent.keyboard('{Enter}');

    expect(screen.getByRole('dialog', { name: '선물 펀딩비·미체결약정 상세 설명' })).toHaveTextContent('-0.0010% / OI 2.00%');

    await userEvent.click(screen.getByRole('tab', { name: /eth.*이더리움/i }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByRole('heading', { name: /이더리움 시그널/i })).toBeInTheDocument();
    expect(screen.queryByText('-0.0010% / OI 2.00%')).not.toBeInTheDocument();
  });

  it('explains unavailable funding and open-interest data without presenting it as a zero score', async () => {
    const unavailableFuturesPayload = {
      ...okPayload,
      assets: okPayload.assets.map((asset) => ({
        ...asset,
        indicators: asset.indicators.filter((indicator) => indicator.id !== 'futures-positioning'),
        missingFeatures: ['funding', 'open-interest'],
        scorePolicy: 'missing features are not converted to zero or full credit; available indicator weights are normalized to 100 and limitations are exposed.',
      })),
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => unavailableFuturesPayload }));

    render(createElement(Home));

    expect(await screen.findByText('선물 펀딩비와 미체결약정 데이터를 가져오지 못했습니다.')).toBeInTheDocument();
    expect(screen.getByText('진단 점수는 사용 가능한 지표를 정규화하지만, coverage가 100%가 아니므로 강력 판정과 이벤트는 차단됩니다.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /선물 펀딩비·미체결약정.*상세 설명 열기/i })).not.toBeInTheDocument();
  });

  it('uses red for sell signal tags and the score gauge', async () => {
    const sellPayload = {
      ...okPayload,
      assets: okPayload.assets.map((asset) =>
        asset.symbol === 'BTC' ? { ...asset, overallScore: 10, signal: { label: '강력 매도', tone: 'negative' } } : asset,
      ),
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => sellPayload }));

    render(createElement(Home));

    const meter = await screen.findByRole('meter', { name: /비트코인 시그널 점수/i });
    expect(meter.querySelector('circle.stroke-rose-300')).toBeInTheDocument();
    expect(within(meter).getByText('강력 매도')).toHaveClass('text-rose-100');
  });

  it.each([
    ['강력 매수', 'positive', 'stroke-emerald-300', 'text-emerald-100'],
    ['매수', 'positive', 'stroke-emerald-300', 'text-emerald-100'],
    ['관망', 'neutral', 'stroke-amber-300', 'text-amber-100'],
    ['매도', 'negative', 'stroke-rose-300', 'text-rose-100'],
    ['강력 매도', 'negative', 'stroke-rose-300', 'text-rose-100'],
  ] as const)('maps %s to its dynamic signal color in the pill and score gauge', async (label, tone, gaugeClass, pillClass) => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          ...okPayload,
          assets: okPayload.assets.map((asset) =>
            asset.symbol === 'BTC'
              ? {
                  ...asset,
                  signal: { label, tone },
                  overallScore: label === '강력 매수' ? 85 : label === '매수' ? 65 : label === '관망' ? 50 : label === '매도' ? 30 : 10,
                }
              : asset,
          ),
        }),
      }),
    );

    render(createElement(Home));

    const meter = await screen.findByRole('meter', { name: /비트코인 시그널 점수/i });
    expect(meter.querySelector(`circle.${gaugeClass}`)).toBeInTheDocument();
    expect(within(meter).getByText(label)).toHaveClass(pillClass);
    expect(screen.getByRole('tab', { name: new RegExp(`btc.*${label}`, 'i') })).toHaveTextContent(label);
  });

  it('shows an unobtrusive Korean state when KRW conversion is unavailable', async () => {
    const usdOnlyPayload = {
      ...okPayload,
      usdKrwRate: null,
      fxUnavailable: true,
      assets: okPayload.assets.map((asset) => ({
        ...asset,
        indicators: asset.indicators.map((indicator) =>
          indicator.id === 'moving-averages' ? { ...indicator, value: asset.symbol === 'BTC' ? '$65,000 / MA20 $63,000 / MA50 $61,000' : '$3,200 / MA20 $3,100 / MA50 $3,250' } : indicator,
        ),
      })),
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => usdOnlyPayload }));

    render(createElement(Home));

    expect((await screen.findAllByText('$65,000')).length).toBeGreaterThan(0);
    expect(screen.queryByText(/₩89,050,000/)).not.toBeInTheDocument();
    expect(screen.getByText(/원화 환산을 잠시 표시할 수 없습니다/)).toBeInTheDocument();
  });

  it('exposes a manual refresh loading state and updates the timestamp', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => okPayload })
      .mockImplementationOnce(
        () => new Promise((resolve) => setTimeout(() => resolve({ ok: true, json: async () => ({ ...okPayload, asOf: '2026-08-05T00:01:00.000Z' }) }), 20)),
      );
    vi.stubGlobal('fetch', fetchMock);

    render(createElement(Home));
    await screen.findByRole('heading', { name: /비트코인 시그널/i });

    fireEvent.click(screen.getByRole('button', { name: /시그널 새로고침/i }));

    expect(screen.getByRole('button', { name: /시그널 새로고침 중/i })).toBeDisabled();
    await waitFor(() => expect(screen.getByText(/0시 1분 0초/)).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('automatically refreshes every 60 seconds', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => okPayload });
    let intervalCallback: (() => void) | null = null;
    const originalSetInterval = window.setInterval.bind(window);
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(window, 'setInterval').mockImplementation(((handler: TimerHandler, timeout?: number) => {
      if (timeout === 60000) {
        intervalCallback = handler as () => void;
      }
      return originalSetInterval(handler, timeout) as unknown as NodeJS.Timeout;
    }) as unknown as typeof setInterval);
    vi.spyOn(window, 'clearInterval').mockImplementation(() => undefined);

    render(createElement(Home));
    await screen.findByRole('heading', { name: /비트코인 시그널/i });

    expect(intervalCallback).not.toBeNull();
    await act(async () => {
      intervalCallback?.();
    });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });

  it('presents API failures without removing the stale dashboard', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => okPayload })
      .mockResolvedValueOnce({ ok: false });
    vi.stubGlobal('fetch', fetchMock);

    render(createElement(Home));
    await screen.findByRole('heading', { name: /비트코인 시그널/i });

    await userEvent.click(screen.getByRole('button', { name: /시그널 새로고침/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/시그널을 새로고침하지 못했습니다/i);
    expect(screen.getByText(/마지막으로 성공한 스냅샷을 표시합니다/i)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /비트코인 시그널/i })).toBeInTheDocument();
  });

  it('keeps the newest successful refresh when an older request fails later', async () => {
    const older = deferred<{ ok: boolean; json: () => Promise<typeof okPayload> }>();
    const newerPayload = { ...okPayload, asOf: '2026-08-05T00:02:00.000Z' };
    const newer = deferred<{ ok: boolean; json: () => Promise<typeof okPayload> }>();
    const fetchMock = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => okPayload }).mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);
    vi.stubGlobal('fetch', fetchMock);
    const intervalSpy = vi.spyOn(window, 'setInterval').mockReturnValue(1 as unknown as NodeJS.Timeout);
    vi.spyOn(window, 'clearInterval').mockImplementation(() => undefined);

    render(createElement(Home));
    await screen.findByRole('heading', { name: /비트코인 시그널/i });
    const intervalCallback = intervalSpy.mock.calls[0][0] as () => void;

    await act(async () => intervalCallback());
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await act(async () => intervalCallback());
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    await act(async () => {
      newer.resolve({ ok: true, json: async () => newerPayload });
      await newer.promise;
    });
    await waitFor(() => expect(screen.getByText(/0시 2분 0초/)).toBeInTheDocument());
    await act(async () => {
      older.resolve({ ok: false, json: async () => okPayload });
      await older.promise;
    });

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /비트코인 시그널/i })).toBeInTheDocument();
  });

  it('shows Korean alert controls and only asks browser notification permission after an explicit click', async () => {
    const requestPermission = vi.fn().mockResolvedValue('granted');
    vi.stubGlobal('Notification', { permission: 'default', requestPermission });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => okPayload }));

    render(createElement(Home));
    await screen.findByRole('heading', { name: /비트코인 시그널/i });

    expect(screen.getByRole('heading', { name: '극단 시그널 알람' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '브라우저 알림 허용' })).toBeInTheDocument();
    expect(requestPermission).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: '브라우저 알림 허용' }));

    expect(requestPermission).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/브라우저 알림 권한이 허용되었습니다/)).toBeInTheDocument();
  });

  it('creates in-app alert history from a manual threshold re-entry and keeps it after refresh', async () => {
    const initialPayload = { ...okPayload, assets: okPayload.assets.map((asset) => (asset.symbol === 'BTC' ? { ...asset, overallScore: 79, signal: { label: '매수', tone: 'positive' } } : asset)) };
    const crossedPayload = { ...okPayload, asOf: '2026-08-05T00:01:00.000Z', assets: okPayload.assets.map((asset) => (asset.symbol === 'BTC' ? { ...asset, overallScore: 82, signal: { label: '강력 매수', tone: 'positive' } } : asset)) };
    const fetchMock = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => initialPayload }).mockResolvedValueOnce({ ok: true, json: async () => crossedPayload });
    vi.stubGlobal('fetch', fetchMock);

    render(createElement(Home));
    await screen.findByRole('heading', { name: /비트코인 시그널/i });
    await userEvent.click(screen.getByRole('button', { name: /시그널 새로고침/i }));

    const alert = await screen.findByRole('status', { name: /실시간 극단 시그널 알림/i });
    expect(alert).toHaveTextContent('🚨 [강력 매수 시그널] BTC 종합 점수 82점 달성!');
    expect(alert).toHaveTextContent('적극적인 분할 매수 타점입니다.');
    expect(screen.getByRole('list', { name: '최근 극단 시그널 알람 이력' })).toHaveTextContent('BTC 종합 점수 82점 달성');

    cleanup();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => crossedPayload }));
    render(createElement(Home));

    expect(await screen.findByRole('list', { name: '최근 극단 시그널 알람 이력' })).toHaveTextContent('BTC 종합 점수 82점 달성');
  });

  it.each([
    ['denied permission', 'denied' as NotificationPermission],
    ['unsupported Notification API', 'unsupported' as const],
  ])('keeps in-app alerts and history when browser notifications are %s', async (_label, permission) => {
    if (permission === 'unsupported') {
      Reflect.deleteProperty(window, 'Notification');
    } else {
      class FakeNotification {}
      Object.defineProperty(FakeNotification, 'permission', { value: permission, configurable: true });
      vi.stubGlobal('Notification', FakeNotification);
    }
    const initialPayload = { ...okPayload, assets: okPayload.assets.map((asset) => (asset.symbol === 'ETH' ? { ...asset, overallScore: 21, signal: { label: '매도', tone: 'negative' } } : asset)) };
    const crossedPayload = { ...okPayload, asOf: '2026-08-05T00:01:00.000Z', assets: okPayload.assets.map((asset) => (asset.symbol === 'ETH' ? { ...asset, overallScore: 20, signal: { label: '강력 매도', tone: 'negative' } } : asset)) };
    const fetchMock = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => initialPayload }).mockResolvedValueOnce({ ok: true, json: async () => crossedPayload });
    vi.stubGlobal('fetch', fetchMock);

    render(createElement(Home));
    await screen.findByRole('heading', { name: /비트코인 시그널/i });
    await userEvent.click(screen.getByRole('button', { name: /시그널 새로고침/i }));

    const alert = await screen.findByRole('status', { name: /실시간 극단 시그널 알림/i });
    expect(alert).toHaveTextContent('⚠️ [강력 매도 시그널] ETH 종합 점수 20점 하락!');
    expect(alert).toHaveTextContent('수익 중이라면 즉시 분할 익절 또는 현금화를 권장합니다.');
    expect(screen.getByRole('list', { name: '최근 극단 시그널 알람 이력' })).toHaveTextContent('ETH 종합 점수 20점 하락');
  });

  it('keeps a successful signal refresh when a granted browser notification constructor throws', async () => {
    class ThrowingNotification {
      static permission = 'granted' as NotificationPermission;

      constructor() {
        throw new Error('notification delivery failed');
      }
    }
    vi.stubGlobal('Notification', ThrowingNotification);
    const initialPayload = { ...okPayload, assets: okPayload.assets.map((asset) => (asset.symbol === 'BTC' ? { ...asset, overallScore: 79, signal: { label: '매수', tone: 'positive' } } : asset)) };
    const crossedPayload = { ...okPayload, asOf: '2026-08-05T00:01:00.000Z', assets: okPayload.assets.map((asset) => (asset.symbol === 'BTC' ? { ...asset, overallScore: 82, signal: { label: '강력 매수', tone: 'positive' } } : asset)) };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({ ok: true, json: async () => initialPayload }).mockResolvedValueOnce({ ok: true, json: async () => crossedPayload }));

    render(createElement(Home));
    await screen.findByRole('heading', { name: /비트코인 시그널/i });
    await userEvent.click(screen.getByRole('button', { name: /시그널 새로고침/i }));

    expect(await screen.findByRole('status', { name: /실시간 극단 시그널 알림/i })).toHaveTextContent('BTC 종합 점수 82점 달성');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '시그널 새로고침' })).toBeEnabled();
  });

  it('continues with safe defaults when localStorage reads are unavailable', async () => {
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage unavailable');
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => okPayload }));

    render(createElement(Home));

    expect(await screen.findByRole('heading', { name: /비트코인 시그널/i })).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: '극단 시그널 알람 활성화' })).toBeChecked();
    expect(screen.getByText('아직 발생한 극단 시그널 알람이 없습니다.')).toBeInTheDocument();
    getItem.mockRestore();
  });

  it('recovers from corrupted alert localStorage and replaces it with parseable state on the first refresh', async () => {
    window.localStorage.setItem('crypto-signal-dashboard:extreme-alert-state', '{bad json');
    window.localStorage.setItem('crypto-signal-dashboard:extreme-alert-history', '{bad json');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => okPayload }));

    render(createElement(Home));
    await screen.findByRole('heading', { name: /비트코인 시그널/i });

    expect(screen.getByText('아직 발생한 극단 시그널 알람이 없습니다.')).toBeInTheDocument();
    expect(() => JSON.parse(window.localStorage.getItem('crypto-signal-dashboard:extreme-alert-state') ?? '')).not.toThrow();
    expect(() => JSON.parse(window.localStorage.getItem('crypto-signal-dashboard:extreme-alert-history') ?? '')).not.toThrow();
  });

  it('does not repeat alerts while disabled or while the score remains in the same extreme zone', async () => {
    const firstExtreme = { ...okPayload, assets: okPayload.assets.map((asset) => (asset.symbol === 'BTC' ? { ...asset, overallScore: 81, signal: { label: '강력 매수', tone: 'positive' } } : asset)) };
    const stillExtreme = { ...okPayload, asOf: '2026-08-05T00:01:00.000Z', assets: okPayload.assets.map((asset) => (asset.symbol === 'BTC' ? { ...asset, overallScore: 84, signal: { label: '강력 매수', tone: 'positive' } } : asset)) };
    const fetchMock = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => okPayload }).mockResolvedValueOnce({ ok: true, json: async () => firstExtreme }).mockResolvedValueOnce({ ok: true, json: async () => stillExtreme });
    vi.stubGlobal('fetch', fetchMock);

    render(createElement(Home));
    await screen.findByRole('heading', { name: /비트코인 시그널/i });
    await userEvent.click(screen.getByRole('switch', { name: '극단 시그널 알람 활성화' }));
    await userEvent.click(screen.getByRole('button', { name: /시그널 새로고침/i }));

    expect(screen.queryByRole('status', { name: /실시간 극단 시그널 알림/i })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('switch', { name: '극단 시그널 알람 활성화' }));
    await userEvent.click(screen.getByRole('button', { name: /시그널 새로고침/i }));
    expect(screen.queryByRole('status', { name: /실시간 극단 시그널 알림/i })).not.toBeInTheDocument();
  });
});
