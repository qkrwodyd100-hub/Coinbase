import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { act, createElement } from 'react';
import Home from '@/app/page';

const okPayload = {
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

describe('dashboard behavior', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('renders successful BTC data and lets users switch to ETH', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => okPayload }));

    render(createElement(Home));

    expect(await screen.findByRole('heading', { name: /bitcoin signal/i })).toBeInTheDocument();
    expect(screen.getByText('$65,000')).toBeInTheDocument();
    expect(screen.getAllByText('Strong Buy').length).toBeGreaterThan(0);

    await userEvent.click(screen.getByRole('tab', { name: /eth.*ethereum/i }));

    expect(screen.getByRole('heading', { name: /ethereum signal/i })).toBeInTheDocument();
    expect(screen.getByText('$3,200')).toBeInTheDocument();
    expect(screen.getAllByText('Neutral').length).toBeGreaterThan(0);
  });

  it('exposes a manual refresh loading state and updates the timestamp', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => okPayload })
      .mockImplementationOnce(
        () => new Promise((resolve) => setTimeout(() => resolve({ ok: true, json: async () => ({ ...okPayload, asOf: '2026-08-05T00:01:00.000Z' }) }), 20)),
      );
    vi.stubGlobal('fetch', fetchMock);

    render(createElement(Home));
    await screen.findByRole('heading', { name: /bitcoin signal/i });

    fireEvent.click(screen.getByRole('button', { name: /refresh signals/i }));

    expect(screen.getByRole('button', { name: /refreshing signals/i })).toBeDisabled();
    await waitFor(() => expect(screen.getByText(/00:01:00/)).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('automatically refreshes every 60 seconds', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => okPayload });
    let intervalCallback: (() => void) | null = null;
    const originalSetInterval = window.setInterval.bind(window);
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(window, 'setInterval').mockImplementation(((handler: TimerHandler, timeout?: number) => {
      if (timeout === 60000) {
        intervalCallback = handler as () => void;
      }
      return originalSetInterval(handler, timeout) as unknown as NodeJS.Timeout;
    }) as unknown as typeof setInterval);
    vi.spyOn(window, 'clearInterval').mockImplementation(() => undefined);

    render(createElement(Home));
    await screen.findByRole('heading', { name: /bitcoin signal/i });

    expect(intervalCallback).not.toBeNull();
    await act(async () => {
      intervalCallback?.();
    });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });

  it('presents API failures without removing the stale dashboard', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => okPayload })
      .mockResolvedValueOnce({ ok: false });
    vi.stubGlobal('fetch', fetchMock);

    render(createElement(Home));
    await screen.findByRole('heading', { name: /bitcoin signal/i });

    await userEvent.click(screen.getByRole('button', { name: /refresh signals/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/could not refresh/i);
    expect(screen.getByText(/showing the last successful snapshot/i)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /bitcoin signal/i })).toBeInTheDocument();
  });
});
