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
  title: "[5kph] 강릉 DSI 지도",
  description: "강릉시 도로 스트리트뷰 지점 및 분석 진행 현황",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ko" className={gowunBatang.variable}>
      <body>{children}</body>
    </html>
  );
}
