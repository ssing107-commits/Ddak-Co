import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "./providers";

// push 테스트용 주석 (삭제해도 됨)

export const metadata: Metadata = {
  title: "아이디어 기획서",
  description: "Claude로 프로젝트 기획서를 한국어로 생성합니다.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko" className="h-full antialiased">
      <body className="min-h-full flex flex-col font-sans">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
