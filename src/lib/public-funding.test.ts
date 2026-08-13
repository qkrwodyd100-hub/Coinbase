import { describe, expect, it, vi } from 'vitest';
import { fetchPublicFundingHistory } from '@/lib/public-funding';

describe('public historical funding data', () => {
  it('uses the public Bybit endpoint so a Binance HTTP 451 cannot break the production build', async () => {
    const request = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('fapi.binance.com')) return new Response('Unavailable For Legal Reasons', { status: 451 });
      return Response.json({
        retCode: 0,
        retMsg: 'OK',
        result: {
          list: [
            { symbol: 'BTCUSDT', fundingRate: '0.0001', fundingRateTimestamp: '172800000' },
            { symbol: 'BTCUSDT', fundingRate: '-0.0002', fundingRateTimestamp: '144000000' },
          ],
        },
      });
    });

    const rows = await fetchPublicFundingHistory('BTCUSDT', 144_000_000, 172_800_001, request);

    expect(request).toHaveBeenCalledOnce();
    expect(String(request.mock.calls[0][0])).toMatch(/^https:\/\/api\.bybit\.com\/v5\/market\/funding\/history\?/);
    expect(rows).toEqual([
      { fundingTime: 144_000_000, fundingRatePercent: -0.02 },
      { fundingTime: 172_800_000, fundingRatePercent: 0.01 },
    ]);
  });

  it('fails closed on malformed or unsuccessful upstream responses', async () => {
    await expect(
      fetchPublicFundingHistory('BTCUSDT', 0, 1, async () => Response.json({ retCode: 10001, retMsg: 'bad request', result: { list: [] } })),
    ).rejects.toThrow(/Bybit.*10001/i);
  });

  it('maps Binance spot SHIB to Bybit linear SHIB1000 without changing funding percentages', async () => {
    const requests: string[] = [];
    const request = async (input: string | URL | Request) => {
      requests.push(String(input));
      return Response.json({ retCode: 0, retMsg: 'OK', result: { list: [] } });
    };

    await fetchPublicFundingHistory('SHIBUSDT', 0, 1, request);

    expect(requests[0]).toContain('symbol=SHIB1000USDT');
  });
});
