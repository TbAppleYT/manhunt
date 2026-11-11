import type { Metadata, Viewport } from 'next';
import './proto.css';
import './globals.css';
import { themeBootScript } from '@/lib/client/theme';
import { SwRegister } from '@/components/SwRegister';

export const metadata: Metadata = {
  title: 'manhunt.',
  description: 'Private hide-and-seek for friends at Town Center of Virginia Beach.',
  manifest: '/manifest.webmanifest',
  icons: { icon: '/favicon.svg', apple: '/icons/apple-touch-icon.png' },
  appleWebApp: { capable: true, title: 'manhunt.', statusBarStyle: 'default' },
  robots: { index: false, follow: false },
};
export const viewport: Viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover', themeColor: '#ffffff' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Inter from Google Fonts, exactly as specified in the brief. */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link href="https://fonts.googleapis.com/css2?family=Inter:ital,opsz,wght@0,14..32,100..900;1,14..32,100..900&display=swap" rel="stylesheet" />
        <script dangerouslySetInnerHTML={{ __html: themeBootScript }} />
      </head>
      <body>
        {children}
        <SwRegister />
      </body>
    </html>
  );
}
