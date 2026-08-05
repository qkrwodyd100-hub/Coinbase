# Crypto Signal Dashboard

BTC/ETH market signal dashboard based on RSI, Fear & Greed, moving averages, and futures funding rates.

## Data sources

- Binance public spot ticker and daily kline endpoints for live USD prices, MA20, MA50, and RSI(14) closes.
- Binance public USD-M futures premium index endpoint for current funding rates.
- Alternative.me Fear & Greed endpoint for shared market sentiment.

All external calls are proxied through `GET /api/signals`, validated before scoring, cached with `s-maxage=55`, and returned as a compact dashboard payload. The client refreshes on load, manually via the Refresh button, and automatically every 60 seconds.

## Moving-average mixed-case scoring

The required exact cases are preserved. Remaining deterministic cases are:

- 10 points when price is at or above either MA20 or MA50, but the full bullish condition is not met.
- 5 points when price is below both averages, but MA20 is not below MA50.

These mixed cases never exceed the 25-point maximum.

## Scripts

```bash
npm install
npm run lint
npm run typecheck
npm test
npm run build
npm run test:e2e
```
