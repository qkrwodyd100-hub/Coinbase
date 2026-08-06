import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'BTC ETH 크립토 시그널 대시보드',
  description: 'RSI, 심리, 이동평균, 펀딩을 사용하는 BTC와 ETH 실시간 시그널 대시보드입니다.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
