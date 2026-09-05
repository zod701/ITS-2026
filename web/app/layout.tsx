import type { Metadata } from "next";
import { Gowun_Batang } from "next/font/google";
import "leaflet/dist/leaflet.css";
import "./globals.css";

const gowunBatang = Gowun_Batang({
  weight: ["400", "700"],
  subsets: ["latin"],
  variable: "--font-modal",
});

export const metadata: Metadata = {
  title: "[5kph] 강릉 ITS 세계총회 아이디어 공모전",
  description: "강릉시 도로 스트리트뷰 지점 및 분석 진행 현황",
};

// 페이지 렌더 전에 저장된 테마를 <html>에 적용 -> 라이트/다크 전환 시 깜빡임(FOUC) 방지.
const themeInitScript = `
(function () {
  try {
    var saved = localStorage.getItem("theme");
    if (saved === "light" || saved === "dark") {
      document.documentElement.setAttribute("data-theme", saved);
    }
  } catch (e) {}
})();
`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ko" className={gowunBatang.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
