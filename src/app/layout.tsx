import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "要吃什麼？ What To Eat",
  description: "基於地理位置的決策輔助網頁應用",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-TW">
      <body>
        <main className="container">
          {children}
        </main>
      </body>
    </html>
  );
}
