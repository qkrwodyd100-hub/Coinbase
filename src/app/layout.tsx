import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'BTC ETH Crypto Signal Dashboard',
  description: 'Live BTC and ETH signal dashboard using RSI, sentiment, moving averages, and funding.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
