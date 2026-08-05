import { expect, type Page, test } from '@playwright/test';

const payload = {
  asOf: '2026-08-05T00:00:00.000Z',
  assets: [
    {
      symbol: 'BTC',
      name: 'Bitcoin',
      price: 65000,
      overallScore: 85,
      signal: { label: 'Strong Buy', tone: 'positive' },
      stale: false,
      indicators: [
        { id: 'rsi', title: 'RSI (14)', value: '28.00', score: 30, maxScore: 30, interpretation: 'Oversold conditions reward the highest RSI score.' },
        { id: 'fear-greed', title: 'Fear & Greed', value: '22', score: 20, maxScore: 20, interpretation: 'Extreme fear can mark contrarian accumulation zones.' },
        { id: 'moving-averages', title: 'Moving averages', value: '$65,000 / MA20 $63,000 / MA50 $61,000', score: 25, maxScore: 25, interpretation: 'Price is above both averages and short-term trend leads.' },
        { id: 'funding', title: 'Futures funding', value: '-0.0010%', score: 25, maxScore: 25, interpretation: 'Neutral or negative funding avoids overheated long leverage.' },
      ],
    },
    {
      symbol: 'ETH',
      name: 'Ethereum',
      price: 3200,
      overallScore: 55,
      signal: { label: 'Neutral', tone: 'neutral' },
      stale: false,
      indicators: [
        { id: 'rsi', title: 'RSI (14)', value: '52.00', score: 15, maxScore: 30, interpretation: 'Mid-range momentum is constructive but not deeply discounted.' },
        { id: 'fear-greed', title: 'Fear & Greed', value: '50', score: 10, maxScore: 20, interpretation: 'Balanced sentiment receives a middle score.' },
        { id: 'moving-averages', title: 'Moving averages', value: '$3,200 / MA20 $3,100 / MA50 $3,250', score: 15, maxScore: 25, interpretation: 'Price is above MA20 but trend confirmation is mixed.' },
        { id: 'funding', title: 'Futures funding', value: '0.0200%', score: 5, maxScore: 25, interpretation: 'Moderate positive funding reduces the futures score.' },
      ],
    },
  ],
};

const refreshedPayload = { ...payload, asOf: '2026-08-05T00:01:00.000Z' };
const stalePayload = {
  ...payload,
  assets: payload.assets.map((asset) => (asset.symbol === 'BTC' ? { ...asset, stale: true } : asset)),
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
  const meter = page.getByRole('meter', { name: /bitcoin signal score/i });
  await expect(meter).toHaveAttribute('aria-valuenow', '85');
  await expect(meter.getByText('Strong Buy')).toBeVisible();

  const stroke = await meter.locator('circle').nth(1).evaluate((element) => getComputedStyle(element).stroke);
  const pillColor = await meter.getByText('Strong Buy').evaluate((element) => getComputedStyle(element).color);
  expect(stroke).toBe('lab(83.9203 -48.7124 13.8849)');
  expect(pillColor).toBe('lab(94.9004 -17.0769 5.63836)');
}

test('dashboard renders mocked live data and supports asset switching', async ({ page }) => {
  const assertNoClientErrors = expectNoClientErrors(page);
  await page.route('**/api/signals', (route) => route.fulfill({ json: payload }));

  await page.goto('/');

  await expect(page.getByRole('heading', { name: /bitcoin signal/i })).toBeVisible();
  await expect(page.getByRole('tab', { name: /btc.*bitcoin/i }).getByText('$65,000')).toBeVisible();
  await expect(page.getByText('Strong Buy').last()).toBeVisible();

  const viewport = page.viewportSize();
  for (const pill of [page.getByRole('tab', { name: /btc.*bitcoin/i }).getByText('Strong Buy'), page.getByRole('tab', { name: /eth.*ethereum/i }).getByText('Neutral')]) {
    const box = await pill.boundingBox();
    expect(box).not.toBeNull();
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(viewport?.width ?? Number.POSITIVE_INFINITY);
  }

  await page.getByRole('tab', { name: /eth.*ethereum/i }).click();

  await expect(page.getByRole('heading', { name: /ethereum signal/i })).toBeVisible();
  await expect(page.getByRole('tab', { name: /eth.*ethereum/i }).getByText('$3,200')).toBeVisible();
  await expect(page.getByText('Neutral').last()).toBeVisible();
  await assertNoClientErrors();
});

test('dashboard exposes accessible loading and score states with positive signal color', async ({ page }, testInfo) => {
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

  await expect(page.getByRole('status', { name: /loading dashboard/i })).toBeVisible();
  releaseInitialResponse();
  await expect(page.getByRole('heading', { name: /bitcoin signal/i })).toBeVisible();
  await expectPositiveSignalStyling(page);
  await testInfo.attach(`${testInfo.project.name}-dashboard`, { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
  await assertNoClientErrors();
});

test('manual refresh disables the refresh action and replaces the timestamp', async ({ page }) => {
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
  await expect(page.getByRole('heading', { name: /bitcoin signal/i })).toBeVisible();
  await expect(page.getByText(/(?:00|24):00:00/)).toBeVisible();
  const initialRequestCount = requestCount;
  holdRefresh = true;

  await page.getByRole('button', { name: /refresh signals/i }).click();

  await expect(page.getByRole('button', { name: /refreshing signals/i })).toBeDisabled();
  releaseRefresh();
  await expect(page.getByText(/(?:00|24):01:00/)).toBeVisible();
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
  await expect(page.getByRole('heading', { name: /bitcoin signal/i })).toBeVisible();
  await expect(page.getByText(/(?:00|24):00:00/)).toBeVisible();
  const initialRequestCount = requestCount;
  afterInitialRender = true;

  await page.clock.fastForward(60_000);

  await expect(page.getByText(/(?:00|24):01:00/)).toBeVisible();
  expect(requestCount).toBeGreaterThan(initialRequestCount);
  await assertNoClientErrors();
});

test('dashboard keeps stale data visible after refresh failure', async ({ page }) => {
  const assertNoClientErrors = expectNoClientErrors(page);
  let shouldFail = false;
  await page.route('**/api/signals', (route) => {
    return shouldFail
      ? route.fulfill({ status: 502, json: { error: 'Unable to refresh crypto signals.' } })
      : route.fulfill({ json: payload });
  });

  await page.goto('/');
  await expect(page.getByRole('heading', { name: /bitcoin signal/i })).toBeVisible();

  shouldFail = true;
  await page.getByRole('button', { name: /refresh signals/i }).click();

  await expect(page.getByText(/could not refresh signals/i)).toContainText(/could not refresh/i);
  await expect(page.getByText(/showing the last successful snapshot/i)).toBeVisible();
  await expect(page.getByRole('heading', { name: /bitcoin signal/i })).toBeVisible();
  await assertNoClientErrors();
});

test('dashboard shows an initial API error without stale-data copy when no snapshot exists', async ({ page }) => {
  const assertNoClientErrors = expectNoClientErrors(page);
  await page.route('**/api/signals', (route) => route.fulfill({ status: 502, json: { error: 'Unable to refresh crypto signals.' } }));

  await page.goto('/');

  await expect(page.getByText(/try again in a moment/i)).toBeVisible();
  await expect(page.getByText(/showing the last successful snapshot/i)).toBeHidden();
  await expect(page.getByRole('heading', { name: /bitcoin signal/i })).toBeHidden();
  await assertNoClientErrors();
});

test('dashboard surfaces stale API payloads even when the refresh succeeds', async ({ page }) => {
  const assertNoClientErrors = expectNoClientErrors(page);
  await page.route('**/api/signals', (route) => route.fulfill({ json: stalePayload }));

  await page.goto('/');

  await expect(page.getByRole('heading', { name: /bitcoin signal/i })).toBeVisible();
  await expect(page.getByText(/stale data: showing cached snapshot/i)).toBeVisible();
  await assertNoClientErrors();
});
