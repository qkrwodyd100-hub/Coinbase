import { expect, type Page, test } from '@playwright/test';

const payload = {
  asOf: '2026-08-05T00:00:00.000Z',
  usdKrwRate: 1370,
  fxUnavailable: false,
  assets: [
    {
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
        { id: 'funding', title: '선물 펀딩', value: '-0.0010%', score: 25, maxScore: 25, interpretation: '중립 또는 음수 펀딩은 과열된 롱 레버리지를 피합니다.' },
      ],
    },
    {
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
        { id: 'funding', title: '선물 펀딩', value: '0.0200%', score: 5, maxScore: 25, interpretation: '보통 수준의 양수 펀딩은 선물 점수를 낮춥니다.' },
      ],
    },
  ],
};

const refreshedPayload = { ...payload, asOf: '2026-08-05T00:01:00.000Z' };
const stalePayload = {
  ...payload,
  assets: payload.assets.map((asset) => (asset.symbol === 'BTC' ? { ...asset, stale: true } : asset)),
};
const fxUnavailablePayload = {
  ...payload,
  usdKrwRate: null,
  fxUnavailable: true,
  assets: payload.assets.map((asset) => ({
    ...asset,
    indicators: asset.indicators.map((indicator) =>
      indicator.id === 'moving-averages' ? { ...indicator, value: asset.symbol === 'BTC' ? '$65,000 / MA20 $63,000 / MA50 $61,000' : '$3,200 / MA20 $3,100 / MA50 $3,250' } : indicator,
    ),
  })),
};

function expectNoClientErrors(page: Page) {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.text().includes('Failed to load resource: the server responded with a status of 502')) return;
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('requestfailed', (request) => errors.push(`requestfailed: ${request.url()} ${request.failure()?.errorText ?? ''}`));

  return () => expect(errors).toEqual([]);
}

async function expectPositiveSignalStyling(page: Page) {
  const meter = page.getByRole('meter', { name: /비트코인 시그널 점수/i });
  await expect(meter).toHaveAttribute('aria-valuenow', '85');
  await expect(meter.getByText('강력 매수')).toBeVisible();

  const stroke = await meter.locator('circle').nth(1).evaluate((element) => getComputedStyle(element).stroke);
  const pillColor = await meter.getByText('강력 매수').evaluate((element) => getComputedStyle(element).color);
  expect(stroke).toBe('lab(83.9203 -48.7124 13.8849)');
  expect(pillColor).toBe('lab(94.9004 -17.0769 5.63836)');
}

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

test('dashboard renders Korean live data, KRW prices, and supports asset switching', async ({ page }) => {
  const assertNoClientErrors = expectNoClientErrors(page);
  await page.route('**/api/signals', (route) => route.fulfill({ json: payload }));

  await page.goto('/');

  await expect(page.getByRole('heading', { name: /비트코인 시그널/i })).toBeVisible();
  await expect(page.getByRole('tab', { name: /btc.*비트코인/i }).getByText('$65,000 · ₩89,050,000')).toBeVisible();
  await expect(page.getByText('강력 매수').last()).toBeVisible();
  await expect(page.getByText(/Kraken 선물 펀딩비율/)).toBeVisible();
  const btcMeter = page.getByRole('meter', { name: /비트코인 시그널 점수/i });
  await expect(btcMeter.locator('circle.stroke-emerald-300')).toBeVisible();
  await expect(btcMeter.getByText('강력 매수')).toHaveClass(/text-emerald-100/);
  const btcMovingAverageRows = page.getByRole('list', { name: '이동평균 가격' }).getByRole('listitem');
  await expect(btcMovingAverageRows).toHaveCount(3);
  await expect(btcMovingAverageRows.nth(0)).toHaveText('현재가 $65,000 · ₩89,050,000');
  await expect(btcMovingAverageRows.nth(1)).toHaveText('MA20 $63,000 · ₩86,310,000');
  await expect(btcMovingAverageRows.nth(2)).toHaveText('MA50 $61,000 · ₩83,570,000');
  await expectNoHorizontalOverflow(page);

  await page.getByRole('tab', { name: /eth.*이더리움/i }).click();

  await expect(page.getByRole('heading', { name: /이더리움 시그널/i })).toBeVisible();
  await expect(page.getByRole('tab', { name: /eth.*이더리움/i }).getByText('$3,200 · ₩4,384,000')).toBeVisible();
  await expect(page.getByText('관망').last()).toBeVisible();
  const ethMeter = page.getByRole('meter', { name: /이더리움 시그널 점수/i });
  await expect(ethMeter.locator('circle.stroke-amber-300')).toBeVisible();
  await expect(ethMeter.getByText('관망')).toHaveClass(/text-amber-100/);
  const ethMovingAverageRows = page.getByRole('list', { name: '이동평균 가격' }).getByRole('listitem');
  await expect(ethMovingAverageRows).toHaveCount(3);
  await expect(ethMovingAverageRows.nth(0)).toHaveText('현재가 $3,200 · ₩4,384,000');
  await expect(ethMovingAverageRows.nth(1)).toHaveText('MA20 $3,100 · ₩4,247,000');
  await expect(ethMovingAverageRows.nth(2)).toHaveText('MA50 $3,250 · ₩4,452,500');
  await expectNoHorizontalOverflow(page);
  await assertNoClientErrors();
});

test('dashboard exposes accessible Korean loading and score states with positive signal color', async ({ page }, testInfo) => {
  const assertNoClientErrors = expectNoClientErrors(page);
  let releaseInitialResponse!: () => void;
  const initialResponse = new Promise<void>((resolve) => {
    releaseInitialResponse = resolve;
  });
  await page.route('**/api/signals', async (route) => {
    await initialResponse;
    await route.fulfill({ json: payload });
  });

  await page.goto('/');

  await expect(page.getByRole('status', { name: /대시보드 로딩 중/i })).toBeVisible();
  releaseInitialResponse();
  await expect(page.getByRole('heading', { name: /비트코인 시그널/i })).toBeVisible();
  await expectPositiveSignalStyling(page);
  await testInfo.attach(`${testInfo.project.name}-dashboard`, { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
  await assertNoClientErrors();
});

test('manual refresh disables the Korean refresh action and replaces the timestamp', async ({ page }) => {
  const assertNoClientErrors = expectNoClientErrors(page);
  let releaseRefresh!: () => void;
  const refreshResponse = new Promise<void>((resolve) => {
    releaseRefresh = resolve;
  });
  let requestCount = 0;
  let holdRefresh = false;
  await page.route('**/api/signals', async (route) => {
    requestCount += 1;
    if (holdRefresh) await refreshResponse;
    await route.fulfill({ json: holdRefresh ? refreshedPayload : payload });
  });

  await page.goto('/');
  await expect(page.getByRole('heading', { name: /비트코인 시그널/i })).toBeVisible();
  await expect(page.getByText(/0시 0분 0초/)).toBeVisible();
  const initialRequestCount = requestCount;
  holdRefresh = true;

  await page.getByRole('button', { name: /시그널 새로고침/i }).click();

  await expect(page.getByRole('button', { name: /시그널 새로고침 중/i })).toBeDisabled();
  releaseRefresh();
  await expect(page.getByText(/0시 1분 0초/)).toBeVisible();
  expect(requestCount).toBeGreaterThan(initialRequestCount);
  await assertNoClientErrors();
});

test('60-second automatic refresh uses the newest live payload with controlled time', async ({ page }) => {
  const assertNoClientErrors = expectNoClientErrors(page);
  await page.clock.install({ time: new Date('2026-08-05T00:00:00.000Z') });
  let requestCount = 0;
  let afterInitialRender = false;
  await page.route('**/api/signals', (route) => {
    requestCount += 1;
    return route.fulfill({ json: afterInitialRender ? refreshedPayload : payload });
  });

  await page.goto('/');
  await expect(page.getByRole('heading', { name: /비트코인 시그널/i })).toBeVisible();
  await expect(page.getByText(/0시 0분 0초/)).toBeVisible();
  const initialRequestCount = requestCount;
  afterInitialRender = true;

  await page.clock.fastForward(60_000);

  await expect(page.getByText(/0시 1분 0초/)).toBeVisible();
  expect(requestCount).toBeGreaterThan(initialRequestCount);
  await assertNoClientErrors();
});

test('dashboard keeps stale data visible after refresh failure', async ({ page }) => {
  const assertNoClientErrors = expectNoClientErrors(page);
  let shouldFail = false;
  await page.route('**/api/signals', (route) => {
    return shouldFail ? route.fulfill({ status: 502, json: { error: '크립토 시그널을 새로고침하지 못했습니다.' } }) : route.fulfill({ json: payload });
  });

  await page.goto('/');
  await expect(page.getByRole('heading', { name: /비트코인 시그널/i })).toBeVisible();

  shouldFail = true;
  await page.getByRole('button', { name: /시그널 새로고침/i }).click();

  await expect(page.getByText(/시그널을 새로고침하지 못했습니다/i)).toBeVisible();
  await expect(page.getByText(/마지막으로 성공한 스냅샷/i)).toBeVisible();
  await expect(page.getByRole('heading', { name: /비트코인 시그널/i })).toBeVisible();
  await assertNoClientErrors();
});

test('dashboard shows an initial API error without stale-data copy when no snapshot exists', async ({ page }) => {
  const assertNoClientErrors = expectNoClientErrors(page);
  await page.route('**/api/signals', (route) => route.fulfill({ status: 502, json: { error: '크립토 시그널을 새로고침하지 못했습니다.' } }));

  await page.goto('/');

  await expect(page.getByText(/잠시 후 다시 시도해 주세요/i)).toBeVisible();
  await expect(page.getByText(/마지막으로 성공한 스냅샷/i)).toBeHidden();
  await expect(page.getByRole('heading', { name: /비트코인 시그널/i })).toBeHidden();
  await assertNoClientErrors();
});

test('dashboard surfaces stale API payloads and FX fallback states', async ({ page }) => {
  const assertNoClientErrors = expectNoClientErrors(page);
  await page.route('**/api/signals', (route) => route.fulfill({ json: stalePayload }));

  await page.goto('/');

  await expect(page.getByRole('heading', { name: /비트코인 시그널/i })).toBeVisible();
  await expect(page.getByText(/오래된 데이터: 새로고침 실패 후 캐시된 스냅샷/i)).toBeVisible();
  await assertNoClientErrors();

  await page.route('**/api/signals', (route) => route.fulfill({ json: fxUnavailablePayload }));
  await page.getByRole('button', { name: /시그널 새로고침/i }).click();
  await expect(page.getByText(/원화 환산을 잠시 표시할 수 없습니다/i)).toBeVisible();
  await expect(page.getByRole('tab', { name: /btc.*비트코인/i }).getByText('$65,000')).toBeVisible();
});
