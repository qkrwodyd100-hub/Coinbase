import { expect, test } from '@playwright/test';

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

test('dashboard renders mocked live data and supports asset switching', async ({ page }) => {
  await page.route('**/api/signals', (route) => route.fulfill({ json: payload }));

  await page.goto('/');

  await expect(page.getByRole('heading', { name: /bitcoin signal/i })).toBeVisible();
  await expect(page.getByRole('tab', { name: /btc.*bitcoin/i }).getByText('$65,000')).toBeVisible();
  await expect(page.getByText('Strong Buy').last()).toBeVisible();

  await page.getByRole('tab', { name: /eth.*ethereum/i }).click();

  await expect(page.getByRole('heading', { name: /ethereum signal/i })).toBeVisible();
  await expect(page.getByRole('tab', { name: /eth.*ethereum/i }).getByText('$3,200')).toBeVisible();
  await expect(page.getByText('Neutral').last()).toBeVisible();
});

test('dashboard keeps stale data visible after refresh failure', async ({ page }) => {
  let requestCount = 0;
  await page.route('**/api/signals', (route) => {
    requestCount += 1;
    if (requestCount === 1) {
      return route.fulfill({ json: payload });
    }
    return route.fulfill({ status: 502, json: { error: 'Unable to refresh crypto signals.' } });
  });

  await page.goto('/');
  await expect(page.getByRole('heading', { name: /bitcoin signal/i })).toBeVisible();

  await page.getByRole('button', { name: /refresh signals/i }).click();

  await expect(page.getByText(/could not refresh signals/i)).toContainText(/could not refresh/i);
  await expect(page.getByText(/showing the last successful snapshot/i)).toBeVisible();
  await expect(page.getByRole('heading', { name: /bitcoin signal/i })).toBeVisible();
});
