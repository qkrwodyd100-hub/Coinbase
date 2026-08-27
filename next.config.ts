import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  async redirects() {
    return [
      {
        source: '/:path*',
        has: [{ type: 'host', value: 'crypto-signal-dashboard-chi.vercel.app' }],
        destination: 'https://coinbase-ivory.vercel.app/:path*',
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
