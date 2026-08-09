# Crypto signal backtest report

Generated: 2026-08-09T12:53:46.527Z
Source: deterministic fixture

## Methodology

- Score weights with complete inputs: moving averages 25 + RSI 20 + MFI 20 + funding/open interest 20 + Fear & Greed 15 = 100.
- ETH additionally blends the normalized base score at 95% with ETH/BTC 20-candle relative strength at 5%.
- Missing indicators receive neither zero nor full credit; available weights are normalized to 100 and disclosed below.
- Look-ahead rule: calculate the score after candle close, enter at the next candle open, evaluate only complete 24h (4h bars) or 7d (1d bars) horizons, and exclude the candle starting at the horizon boundary.
- Hit rule: strong-buy succeeds on a +3% intrahorizon high; strong-sell succeeds on a -3% intrahorizon low.

| Asset | Interval | Signal | Count | Hits | Hit rate | Avg close return |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| BTC | 4h | strong-buy | 1 | 1 | 100% | 1.67% |
| BTC | 4h | strong-sell | 1 | 1 | 100% | 6.95% |
| ETH | 4h | strong-buy | 1 | 1 | 100% | 1.67% |
| ETH | 4h | strong-sell | 1 | 1 | 100% | 6.95% |
| SHIB | 4h | strong-buy | 1 | 1 | 100% | 1.67% |
| SHIB | 4h | strong-sell | 1 | 1 | 100% | 6.95% |
| FIL | 4h | strong-buy | 1 | 1 | 100% | 1.67% |
| FIL | 4h | strong-sell | 1 | 1 | 100% | 6.95% |
| STX | 4h | strong-buy | 1 | 1 | 100% | 1.67% |
| STX | 4h | strong-sell | 1 | 1 | 100% | 6.95% |
| DOGE | 4h | strong-buy | 1 | 1 | 100% | 1.67% |
| DOGE | 4h | strong-sell | 1 | 1 | 100% | 6.95% |
| ARB | 4h | strong-buy | 1 | 1 | 100% | 1.67% |
| ARB | 4h | strong-sell | 1 | 1 | 100% | 6.95% |
| XRP | 4h | strong-buy | 1 | 1 | 100% | 1.67% |
| XRP | 4h | strong-sell | 1 | 1 | 100% | 6.95% |

## Coverage

| Asset | Interval | Horizon | Data start | Data end | Evaluated signals | Excluded signals |
| --- | --- | --- | --- | --- | ---: | ---: |
| BTC | 4h | 24h | 2023-11-14T22:13:20.000Z | 2023-11-29T18:13:20.000Z | 2 | 0 |
| BTC | 1d | 7d | 2023-11-14T22:13:20.000Z | 2023-11-29T18:13:20.000Z | 0 | 2 |
| ETH | 4h | 24h | 2023-11-14T22:13:20.000Z | 2023-11-29T18:13:20.000Z | 2 | 0 |
| ETH | 1d | 7d | 2023-11-14T22:13:20.000Z | 2023-11-29T18:13:20.000Z | 0 | 2 |
| SHIB | 4h | 24h | 2023-11-14T22:13:20.000Z | 2023-11-29T18:13:20.000Z | 2 | 0 |
| SHIB | 1d | 7d | 2023-11-14T22:13:20.000Z | 2023-11-29T18:13:20.000Z | 0 | 2 |
| FIL | 4h | 24h | 2023-11-14T22:13:20.000Z | 2023-11-29T18:13:20.000Z | 2 | 0 |
| FIL | 1d | 7d | 2023-11-14T22:13:20.000Z | 2023-11-29T18:13:20.000Z | 0 | 2 |
| STX | 4h | 24h | 2023-11-14T22:13:20.000Z | 2023-11-29T18:13:20.000Z | 2 | 0 |
| STX | 1d | 7d | 2023-11-14T22:13:20.000Z | 2023-11-29T18:13:20.000Z | 0 | 2 |
| DOGE | 4h | 24h | 2023-11-14T22:13:20.000Z | 2023-11-29T18:13:20.000Z | 2 | 0 |
| DOGE | 1d | 7d | 2023-11-14T22:13:20.000Z | 2023-11-29T18:13:20.000Z | 0 | 2 |
| ARB | 4h | 24h | 2023-11-14T22:13:20.000Z | 2023-11-29T18:13:20.000Z | 2 | 0 |
| ARB | 1d | 7d | 2023-11-14T22:13:20.000Z | 2023-11-29T18:13:20.000Z | 0 | 2 |
| XRP | 4h | 24h | 2023-11-14T22:13:20.000Z | 2023-11-29T18:13:20.000Z | 2 | 0 |
| XRP | 1d | 7d | 2023-11-14T22:13:20.000Z | 2023-11-29T18:13:20.000Z | 0 | 2 |

## Data limitations

- missing indicators are explicitly excluded and available weights are normalized; full-data and limited-data results must be compared separately.
- public no-key data can have delayed archive files; reports include data start/end and excluded signal counts.
- Fear & Greed is daily and is forward-filled for 4h candles by UTC date.
