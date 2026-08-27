import { NextResponse } from 'next/server';

export function GET() {
  return NextResponse.json(
    {
      service: 'crypto-signal-dashboard',
      canonicalUrl: 'https://coinbase-ivory.vercel.app',
      commit: process.env.VERCEL_GIT_COMMIT_SHA ?? 'unavailable',
      dataContract: 'signals-v1',
    },
    {
      headers: {
        'Cache-Control': 'public, max-age=0, must-revalidate',
      },
    },
  );
}
