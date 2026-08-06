# Crypto signal backtest report

Generated: 2026-08-06T03:50:56.535Z
Source: Binance public no-key + Alternative.me public no-key

## Methodology

- Score weights with complete inputs: moving averages 25 + RSI 20 + MFI 20 + funding/open interest 20 + Fear & Greed 15 = 100.
- ETH additionally blends the normalized base score at 95% with ETH/BTC 20-candle relative strength at 5%.
- Missing indicators receive neither zero nor full credit; available weights are normalized to 100 and disclosed below.
- Look-ahead rule: calculate the score after candle close, enter at the next candle open, evaluate only complete 24h (4h bars) or 7d (1d bars) horizons, and exclude the candle starting at the horizon boundary.
- Hit rule: strong-buy succeeds on a +3% intrahorizon high; strong-sell succeeds on a -3% intrahorizon low.

| Asset | Interval | Signal | Count | Hits | Hit rate | Avg close return |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| BTC | 4h | strong-buy | 2 | 2 | 100% | 4.53% |
| ETH | 4h | strong-buy | 2 | 0 | 0% | -0.35% |
| BTC | 1d | strong-sell | 2 | 1 | 50% | 4.75% |
| ETH | 1d | strong-sell | 1 | 1 | 100% | -4.2% |

## Coverage

| Asset | Interval | Horizon | Data start | Data end | Evaluated signals | Excluded signals |
| --- | --- | --- | --- | --- | ---: | ---: |
| BTC | 4h | 24h | 2025-08-14T08:00:00.000Z | 2026-08-05T20:00:00.000Z | 2 | 0 |
| ETH | 4h | 24h | 2025-08-14T08:00:00.000Z | 2026-08-05T20:00:00.000Z | 2 | 0 |
| BTC | 1d | 7d | 2024-09-25T00:00:00.000Z | 2026-08-05T00:00:00.000Z | 2 | 0 |
| ETH | 1d | 7d | 2024-09-25T00:00:00.000Z | 2026-08-05T00:00:00.000Z | 1 | 0 |

## Data limitations

- missing indicators are explicitly excluded and available weights are normalized; full-data and limited-data results must be compared separately.
- public no-key data can have delayed archive files; reports include data start/end and excluded signal counts.
- Fear & Greed is daily and is forward-filled for 4h candles by UTC date.
- Historical open interest is unavailable in the public no-key backtest path, so futures positioning uses funding only (10 available points) and the available indicator weights are normalized to 100.
