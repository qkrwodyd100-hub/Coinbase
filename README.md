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

## Durable Slack alerts

Vercel calls the server-only `GET /api/cron/alerts` worker every ten minutes. The worker evaluates the canonical closed `1d` snapshot, establishes the first observation as a baseline, and creates an immutable PostgreSQL outbox event only for `<80 → >=80` strong-buy and `>20 → <=20` strong-sell crossings. The event identity is `(asset, type, signalBarClose)`, so duplicate snapshots cannot enqueue duplicate events; older snapshots cannot roll state backward. Coverage/freshness changes re-baseline without creating an event, and an asset/type cannot have two pending deliveries.

Delivery is suppressed during Asia/Seoul 23:00-05:59 while events remain queued. At 06:00-22:59, workers claim due rows with a lease and `FOR UPDATE SKIP LOCKED`, then call Slack `chat.postMessage` with a deterministic `client_msg_id`. Acknowledged messages move to `sent` and only then update the asset/type `lastSentAt`. Failures retry after 1, 2, 4, and 8 minutes, stop after five persisted attempts, and survive process restarts. Messages include the asset, exact score crossing, closed-bar timeframe/close, feature freshness and coverage, a non-advice/no-execution caveat, and explicit invalidation. The application never executes trades.

Required server-only environment variables:

- `DATABASE_URL`: PostgreSQL connection string. The worker idempotently creates `alert_asset_state` and `alert_outbox`; use a restricted application role with schema/table access.
- `SLACK_BOT_TOKEN`: Slack bot token with `chat:write`; keep it only in the deployment secret store.
- `SLACK_CHANNEL_ID`: destination channel ID. Invite the bot to a private destination channel when applicable.
- `CRON_SECRET`: high-entropy bearer secret used by Vercel Cron for the worker route.

If any variable is missing, the cron route fails closed with `503` and does not expose configuration details. Unauthorized calls return `401`. Dashboard signal reads continue independently.

Production backtests are regenerated with `npm run backtest` from public, no-key sources: Binance spot candles, Bybit linear funding history (`GET /v5/market/funding/history`), and Alternative.me Fear & Greed history. The verified snapshot is committed before deployment; `npm run build` validates freshness, provenance, and complete 8-asset × 2-interval coverage without making region-sensitive market calls. Both commands fail instead of publishing fixture, stale, malformed, or incomplete data.

## 내 보유자산 (local-only)

- `내 보유자산` 탭의 평균매수가, 수량/총투자원금, 날짜, 기한, 메모는 versioned browser `localStorage`에만 저장됩니다. 거래소 연결, 계정, API key, 지갑, 서버 저장, 분석 전송은 없습니다.
- `holdings-v1` pure policy는 시장 점수와 개인 손익/비중을 분리합니다. stale·결측·100% 미만 coverage는 `데이터 부족`으로 fail-closed하며, 추가매수 검토에는 닫힌 1일 봉의 강한 점수, 추세 확인, positive 추가 투자 여력이 모두 필요합니다.
- 비중축소 검토는 새 닫힌 봉의 매도 임계값 하향 통과, 명확한 추세 훼손, 목표기한, 50% 초과 집중을 별도 근거로 노출합니다. 동일 봉 재렌더링이나 단순 저점수만으로 threshold event를 만들지 않습니다. 자동 주문, 주문 수량, 수익 보장, 개인 맞춤 투자자문을 제공하지 않습니다.
- CSV/JSON 수동 import/export와 전체 삭제를 지원합니다. import는 크기·형식·지원 자산·숫자 범위·CSV formula injection을 검증합니다.

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

Canonical production URL은 [https://coinbase-ivory.vercel.app](https://coinbase-ivory.vercel.app)입니다. 공개 저장소 전환, Git integration 배포 복구, alias, build SHA, 환경변수 운영 절차는 [docs/vercel-public-release.md](docs/vercel-public-release.md)를 참고하세요. 대시보드 조회는 환경변수 없이 동작하지만 durable Slack worker는 위의 네 가지 server-only 변수를 요구합니다.
