# Crypto Signal Dashboard

BTC/ETH market signal dashboard based on RSI, Fear & Greed, moving averages, and futures funding rates.

## Data sources

- Binance public daily kline endpoints for closed-bar USD prices, MA20, MA50, RSI(14), MFI(14), and BTC-relative strength.
- Binance public USD-M futures funding and 4h open-interest history aligned no later than the signal-bar close.
- Alternative.me Fear & Greed endpoint for shared market sentiment.

All external calls are proxied through `GET /api/signals`, validated before scoring, cached with `s-maxage=55`, and returned as a compact dashboard payload. The client refreshes on load, manually via the Refresh button, and automatically every 60 seconds.

## Closed-bar signal contract

- Canonical live signal timeframe: `1d` Binance spot candle, evaluated only after the candle is fully closed. The live ticker and in-progress kline are not scoring inputs.
- `signalBarOpen`/`signalBarClose` identify the immutable scoring bar. `nextExecutableAt` is the earliest instant after that close; the application does not execute trades.
- Every feature exposes `source`, `timeframe`, `observedAt`, `availableAt`, `maxAgeMs`, and `status` (`available`, `missing`, or `stale`).
- Maximum age at `signalBarClose`: spot/relative candle 5 minutes, funding 12 hours, open interest 8 hours, and Fear & Greed 48 hours. A whole snapshot becomes stale 26 hours after its bar close.
- Diagnostic scores still normalize available point weights, preserving the existing calibrated weights. `coverageRegime` is `full` at 100 available points, `limited` at 60-99.99, and `insufficient` below 60.
- Strong-buy/strong-sell labels, alerts, and replay events fail closed unless coverage is fresh and exactly 100 points. A coverage/freshness transition re-baselines alert state and cannot emit a threshold event by itself.
- Closed-input replay uses the same `buildAssetSignal` scorer as the API. Backtest entry remains the next candle open after the scored bar closes.

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
