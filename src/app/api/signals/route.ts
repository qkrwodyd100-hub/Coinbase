import { NextResponse } from 'next/server';
import { getDashboardPayload } from '@/lib/market-data';

export const revalidate = 55;

export async function GET() {
  try {
    const payload = await getDashboardPayload();
    return NextResponse.json(payload, {
      headers: {
        'Cache-Control': 'public, s-maxage=55, stale-while-revalidate=120',
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown market data error.';
    return NextResponse.json(
      { error: '크립토 시그널을 새로고침하지 못했습니다.', detail: message },
      { status: 502, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
