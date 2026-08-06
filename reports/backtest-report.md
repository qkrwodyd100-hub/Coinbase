# Crypto signal backtest report

Generated: 2026-08-06T03:12:54.119Z
Source: Binance public no-key + Alternative.me public no-key

Look-ahead rule: score after candle close, enter at next observable candle open.

| Asset | Interval | Signal | Count | Hits | Hit rate | Avg close return |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| BTC | 4h | strong-buy | 2 | 2 | 100% | 4.53% |
| ETH | 4h | strong-buy | 2 | 0 | 0% | -0.35% |
| BTC | 1d | strong-sell | 2 | 1 | 50% | 4.75% |
| ETH | 1d | strong-sell | 1 | 1 | 100% | -4.2% |

## Data limitations

- missing indicators are explicitly excluded and available weights are normalized; full-data and limited-data results must be compared separately.
- public no-key data can have delayed archive files; reports include data start/end and excluded signal counts.
- Fear & Greed is daily and is forward-filled for 4h candles by UTC date.
