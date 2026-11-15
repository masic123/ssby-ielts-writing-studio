import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
import "./font-size.css";
import "../components/question-cards.css";
import "../components/leaderboard.css";
import "./mobile.css";
import "../components/membership.css";
import "../components/target-coaching.css";
import "./tech-studio.css";
import { fontSizeBootstrap } from "@/lib/font-size";
const manrope = localFont({
  src: "../../node_modules/@fontsource-variable/manrope/files/manrope-latin-wght-normal.woff2",
  variable: "--font-manrope",
  display: "swap",
});
export const metadata: Metadata = {
  title: "莎试笔雅 · 雅思写作练习室",
  icons: {
    icon: [{ url: "/favicon-v20261029.png", type: "image/png", sizes: "32x32" }],
    shortcut: "/favicon.ico?v=20261029",
    apple: [{ url: "/apple-touch-icon-v20261029.png", sizes: "180x180" }],
  },
  description: "从真题开始写正文，结合 Simon 与课堂方法逐句修改，逐步写得更清楚。",
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        <link rel="stylesheet" href="/brand-icons-v20261029.css" />
        <script dangerouslySetInnerHTML={{ __html: fontSizeBootstrap }} />
      </head>
      <body className={manrope.variable}>{children}</body>
    </html>
  );
}
