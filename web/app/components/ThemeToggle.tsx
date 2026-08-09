"use client";

import { useEffect, useState } from "react";

type Theme = "light" | "dark";

function getSystemTheme(): Theme {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

interface Props {
  style?: React.CSSProperties;
}

export default function ThemeToggle({ style }: Props) {
  // layout.tsx의 초기화 스크립트가 새로고침 시 html[data-theme]을 이미 설정해두므로,
  // 마운트 시 그 값(없으면 시스템 설정)을 읽어와 버튼 표시와 동기화한다.
  const [theme, setTheme] = useState<Theme | null>(null);

  useEffect(() => {
    const attr = document.documentElement.getAttribute("data-theme");
    setTheme(attr === "light" || attr === "dark" ? attr : getSystemTheme());
  }, []);

  const toggle = () => {
    const next: Theme = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.setAttribute("data-theme", next);
    try {
      localStorage.setItem("theme", next);
    } catch {
      // localStorage 접근 불가 환경(프라이빗 모드 등)에서도 현재 세션 전환은 동작하도록 무시.
    }
  };

  if (theme === null) return null;

  return (
    <>
      <button
        className="theme-toggle"
        onClick={toggle}
        aria-label={theme === "dark" ? "라이트 모드로 전환" : "다크 모드로 전환"}
        title={theme === "dark" ? "라이트 모드로 전환" : "다크 모드로 전환"}
        style={style}
      >
        {theme === "dark" ? (
          <svg viewBox="0 0 16 16" width="20" height="20" fill="currentColor" aria-hidden="true">
            <path d="M8 1a.75.75 0 0 1 .75.75v1.5a.75.75 0 0 1-1.5 0v-1.5A.75.75 0 0 1 8 1Zm0 11a.75.75 0 0 1 .75.75v1.5a.75.75 0 0 1-1.5 0v-1.5A.75.75 0 0 1 8 12Zm7-4a.75.75 0 0 1-.75.75h-1.5a.75.75 0 0 1 0-1.5h1.5A.75.75 0 0 1 15 8ZM4.25 8a.75.75 0 0 1-.75.75H2a.75.75 0 0 1 0-1.5h1.5a.75.75 0 0 1 .75.75Zm8.132-4.132a.75.75 0 0 1 0 1.06l-1.061 1.061a.75.75 0 1 1-1.06-1.06l1.06-1.061a.75.75 0 0 1 1.06 0ZM5.69 10.31a.75.75 0 0 1 0 1.061l-1.06 1.06a.75.75 0 1 1-1.061-1.06l1.06-1.06a.75.75 0 0 1 1.061 0Zm5.63 1.06a.75.75 0 0 1 1.061 1.061l-1.06 1.06a.75.75 0 1 1-1.061-1.06l1.06-1.06ZM5.69 5.69a.75.75 0 0 1-1.06 0L3.568 4.628a.75.75 0 1 1 1.06-1.06L5.69 4.628a.75.75 0 0 1 0 1.061ZM8 4.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Z" />
          </svg>
        ) : (
          <svg viewBox="0 0 16 16" width="20" height="20" fill="currentColor" aria-hidden="true">
            <path d="M6.5 1.5a6.5 6.5 0 1 0 7.743 9.907.5.5 0 0 0-.577-.734A5.5 5.5 0 0 1 6.5 3.5c0-.8.157-1.56.442-2.257a.5.5 0 0 0-.442-.743Z" />
          </svg>
        )}
      </button>

      <style jsx>{`
        .theme-toggle {
          position: absolute;
          z-index: 1000;
          width: 48px;
          height: 48px;
          border-radius: 50%;
          border: none;
          background: var(--fab-bg);
          color: white;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
        }
        .theme-toggle:hover {
          background: var(--fab-bg-hover);
        }
      `}</style>
    </>
  );
}
