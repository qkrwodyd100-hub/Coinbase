# Crypto Signal Dashboard

BTC/ETH market signal dashboard based on RSI, Fear & Greed, moving averages, and futures funding rates.

## Data sources

- Binance public spot ticker and daily kline endpoints for live USD prices, MA20, MA50, and RSI(14) closes.
- Binance public USD-M futures premium index endpoint for current funding rates.
- Alternative.me Fear & Greed endpoint for shared market sentiment.

All external calls are proxied through `GET /api/signals`, validated before scoring, cached with `s-maxage=55`, and returned as a compact dashboard payload. The client refreshes on load, manually via the Refresh button, and automatically every 60 seconds.

Production backtests are regenerated with `npm run backtest` from public, no-key sources: Binance spot candles, Bybit linear funding history (`GET /v5/market/funding/history`), and Alternative.me Fear & Greed history. The verified snapshot is committed before deployment; `npm run build` validates freshness, provenance, and complete 8-asset × 2-interval coverage without making region-sensitive market calls. Both commands fail instead of publishing fixture, stale, malformed, or incomplete data.

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

## Vercel 공개 배포

Canonical production URL은 [https://coinbase-ivory.vercel.app](https://coinbase-ivory.vercel.app)입니다. 공개 저장소 전환, Git integration 배포 복구, alias, build SHA, 환경변수 운영 절차는 [docs/vercel-public-release.md](docs/vercel-public-release.md)를 참고하세요. 현재 애플리케이션은 환경변수를 요구하지 않습니다.
