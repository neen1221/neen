import type { Metadata } from 'next';
import { Inspector } from 'react-dev-inspector';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: "虚拟女友 - AI 陪伴聊天",
    template: "%s | 虚拟女友",
  },
  description: "和有温度的AI虚拟女友聊天，体验真实的陪伴感。",
  keywords: ["虚拟女友", "AI聊天", "陪伴", "情感"],
  authors: [{ name: "Vibe Chat" }],
  generator: "Coze Code",
  robots: {
    index: true,
    follow: true,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const isDev = process.env.COZE_PROJECT_ENV === 'DEV';

  return (
    <html lang="en">
      <body className={`antialiased`}>
        {isDev && <Inspector />}
        {children}
      </body>
    </html>
  );
}
