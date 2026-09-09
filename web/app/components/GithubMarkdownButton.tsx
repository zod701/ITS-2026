"use client";

import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import rehypeRaw from "rehype-raw";
import remarkGfm from "remark-gfm";

const REPO = "zod701/ITS-2026";
const REPO_URL = `https://github.com/${REPO}`;
const BRANCH = "main";
const RAW_BASE = `https://raw.githubusercontent.com/${REPO}/${BRANCH}/`;
const BLOB_BASE = `${REPO_URL}/blob/${BRANCH}/`;

// 저장소 문서를 이 사이트 도메인에서 렌더링하므로 문서 안의 상대 경로는 그대로 두면 404 다
// (예: README 의 result_sample/260818/*.jpg). 이미지는 raw 로, 문서 링크는 GitHub 문서
// 페이지로 돌린다. 절대 URL·앵커·mailto 는 손대지 않는다.
function transformUrl(url: string, key: string): string {
  if (/^(https?:|mailto:|#|data:)/i.test(url)) return url;
  return (key === "src" ? RAW_BASE : BLOB_BASE) + url.replace(/^\.?\//, "");
}

interface CommitInfo {
  sha: string;
  date: string;
  message: string;
}

interface Props {
  /** e.g. ["README.md", "readme.md"] — tried in order until one resolves */
  filenames: string[];
  title: string;
  icon: "github" | "doc";
  style?: React.CSSProperties;
  /** 모달 제목 옆에 붙는 문서 버튼들. 누르면 그 문서를 모달 안에서 미리 본다.
   * 제안서가 둘 이상이라 어느 문서인지 라벨로 갈라 준다(아이콘만으로는 구분되지 않는다). */
  driveDocs?: { id: string; label: string }[];
}

export default function GithubMarkdownButton({
  filenames,
  title,
  icon,
  style,
  driveDocs,
}: Props) {
  const [open, setOpen] = useState(false);
  const [content, setContent] = useState<string | null>(null);
  const [contentError, setContentError] = useState(false);
  const [commit, setCommit] = useState<CommitInfo | null>(null);
  const [commitError, setCommitError] = useState(false);
  // 미리 보는 중인 문서의 Drive 파일 ID. null 이면 마크다운 본문을 보여준다.
  const [openDocId, setOpenDocId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open]);

  useEffect(() => {
    if (!open) return;

    const fetchContent = async () => {
      for (const filename of filenames) {
        const res = await fetch(
          `https://raw.githubusercontent.com/${REPO}/${BRANCH}/${filename}`
        );
        if (res.ok) return res.text();
      }
      throw new Error("fetch failed");
    };

    fetchContent().then(setContent).catch(() => setContentError(true));

    fetch(`https://api.github.com/repos/${REPO}/commits?sha=${BRANCH}&per_page=1`)
      .then((res) => {
        if (!res.ok) throw new Error("commit fetch failed");
        return res.json();
      })
      .then((data) => {
        const latest = data[0];
        setCommit({
          sha: latest.sha,
          date: latest.commit.author.date,
          message: latest.commit.message.split("\n")[0],
        });
      })
      .catch(() => setCommitError(true));
  }, [open, filenames]);

  return (
    <>
      <button
        className="md-fab"
        onClick={() => setOpen(true)}
        aria-label={title}
        title={title}
        style={style}
      >
        {icon === "github" ? (
          <svg viewBox="0 0 16 16" width="24" height="24" fill="currentColor" aria-hidden="true">
            <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
          </svg>
        ) : (
          <svg viewBox="0 0 16 16" width="22" height="22" fill="currentColor" aria-hidden="true">
            <path d="M9.5 0H3a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V4.5L9.5 0Zm.25 1.5L12.75 5H10a.25.25 0 0 1-.25-.25V1.5ZM4 7h8v1H4V7Zm0 2.5h8v1H4v-1ZM4 12h5v1H4v-1Z" />
          </svg>
        )}
      </button>

      {open && (
        <div className="md-modal-backdrop" onClick={() => setOpen(false)}>
          <div
            className={`md-modal ${openDocId ? "md-modal-preview" : ""}`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="md-modal-header">
              <div className="md-modal-title">
                <h2>{title}</h2>
                {driveDocs?.map((doc) => (
                  <button
                    key={doc.id}
                    className="doc-icon-button"
                    onClick={() => setOpenDocId((v) => (v === doc.id ? null : doc.id))}
                    aria-label={`${doc.label} 보기`}
                    title={`${doc.label} 보기`}
                    aria-pressed={openDocId === doc.id}
                  >
                    <svg viewBox="0 0 16 16" width="18" height="18" fill="currentColor" aria-hidden="true">
                      <path d="M9.5 0H3a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V4.5L9.5 0Zm.25 1.5L12.75 5H10a.25.25 0 0 1-.25-.25V1.5ZM4 7h8v1H4V7Zm0 2.5h8v1H4v-1ZM4 12h5v1H4v-1Z" />
                    </svg>
                    <span className="doc-icon-label">{doc.label}</span>
                  </button>
                ))}
              </div>
              <button onClick={() => setOpen(false)} aria-label="닫기">
                ✕
              </button>
            </div>

            {openDocId ? (
              <div className="drive-preview-body">
                <iframe
                  src={`https://drive.google.com/file/d/${openDocId}/preview`}
                  title={driveDocs?.find((d) => d.id === openDocId)?.label ?? title}
                  allow="autoplay"
                />
              </div>
            ) : (
              <div className="md-modal-body">
                <a href={REPO_URL} target="_blank" rel="noopener noreferrer" className="repo-link">
                  See GitHub Repository
                </a>

                <div className="commit-info">
                  {commitError && <span>커밋 정보를 불러오지 못했습니다.</span>}
                  {!commitError && !commit && <span>커밋 정보를 불러오는 중…</span>}
                  {commit && (
                    <>
                      <span>
                        {commit.message} (<code>{commit.sha.slice(0, 7)}</code>)
                      </span>
                      <span>Last commit: {new Date(commit.date).toLocaleString("ko-KR")}</span>
                    </>
                  )}
                </div>

                <hr />

                <div className="markdown-content">
                  {contentError && <p>{filenames[0]}를 불러오지 못했습니다.</p>}
                  {!contentError && content === null && <p>{filenames[0]}를 불러오는 중…</p>}
                  {content !== null && (
                    // rehypeRaw: README 의 가운데 정렬 헤더·예시 이미지·캡션이 전부 HTML 이라
                    // 이게 없으면 통째로 사라진다. 읽는 문서가 자기 저장소 것뿐이라 안전하다.
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      rehypePlugins={[rehypeRaw]}
                      urlTransform={transformUrl}
                    >
                      {content}
                    </ReactMarkdown>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      <style jsx>{`
        .md-fab {
          position: absolute;
          bottom: 24px;
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
        .md-fab:hover {
          background: var(--fab-bg-hover);
        }
        .md-modal-backdrop {
          position: fixed;
          inset: 0;
          background: rgba(0, 0, 0, 0.5);
          z-index: 2000;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .md-modal {
          background: var(--panel-bg);
          color: var(--foreground);
          border-radius: 8px;
          /* README·method 는 표가 많아 680px 에서는 열이 뭉개진다. 넓은 화면에서는
             1100px 까지 쓰고, 좁아지면 화면 폭의 92%까지 따라 줄어든다. */
          width: min(1100px, 92vw);
          max-height: 88vh;
          display: flex;
          flex-direction: column;
          overflow: hidden;
          font-family: var(--font-modal), sans-serif;
        }
        .md-modal-preview {
          height: 88vh;
        }
        .md-modal-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 16px;
          border-bottom: 1px solid var(--border-color);
          flex-shrink: 0;
        }
        .md-modal-title {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .md-modal-header h2 {
          font-weight: 600;
          letter-spacing: 0.01em;
        }
        .md-modal-header button {
          border: none;
          background: none;
          color: var(--foreground);
          font-size: 18px;
          cursor: pointer;
          padding: 4px 8px;
        }
        .doc-icon-button {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 5px;
          padding: 4px !important;
          border-radius: 4px;
          color: var(--text-muted) !important;
        }
        .doc-icon-label {
          font-size: 12px;
          line-height: 1;
          white-space: nowrap;
        }
        .doc-icon-button[aria-pressed="true"] {
          color: var(--link-color) !important;
          background: var(--panel-meta-bg) !important;
        }
        .doc-icon-button:hover {
          color: var(--link-color) !important;
        }
        .md-modal-body {
          padding: 16px;
          overflow-y: auto;
        }
        .drive-preview-body {
          flex: 1;
          min-height: 0;
        }
        .drive-preview-body iframe {
          width: 100%;
          height: 100%;
          border: none;
        }
        .repo-link {
          display: inline-block;
          color: var(--link-color);
          word-break: break-all;
          margin-bottom: 12px;
        }
        .repo-link:hover {
          text-decoration: underline;
        }
        .commit-info {
          display: flex;
          flex-direction: column;
          gap: 4px;
          font-size: 14px;
          color: var(--text-secondary);
          margin-bottom: 12px;
        }
        hr {
          border: none;
          border-top: 1px solid var(--border-color);
          margin-bottom: 12px;
        }
        .markdown-content {
          font-size: 15px;
          line-height: 1.7;
        }
        .markdown-content :global(h1),
        .markdown-content :global(h2),
        .markdown-content :global(h3) {
          font-weight: 600;
          margin: 16px 0 8px;
        }
        .markdown-content :global(p) {
          margin: 8px 0;
        }
        .markdown-content :global(ul),
        .markdown-content :global(ol) {
          padding-left: 24px;
          margin: 8px 0;
        }
        .markdown-content :global(code) {
          background: var(--code-bg);
          padding: 2px 4px;
          border-radius: 4px;
          font-size: 13px;
          font-family: "SFMono-Regular", Consolas, monospace;
        }
        .markdown-content :global(pre) {
          background: var(--code-bg);
          padding: 12px;
          border-radius: 4px;
          overflow-x: auto;
        }
        .markdown-content :global(a) {
          color: var(--link-color);
        }
        /* 표: react-markdown 은 <table> 을 그대로 내보내므로 테두리·여백을 여기서 준다.
           display:block + overflow 는 열이 많은 표가 모달 폭을 넘길 때 표 안에서만
           가로 스크롤되게 한다(모달 전체가 밀리지 않는다). */
        .markdown-content :global(table) {
          display: block;
          width: max-content;
          max-width: 100%;
          overflow-x: auto;
          border-collapse: collapse;
          margin: 12px 0;
          font-size: 14px;
        }
        .markdown-content :global(th),
        .markdown-content :global(td) {
          border: 1px solid var(--border-color);
          padding: 6px 10px;
          text-align: left;
          vertical-align: top;
        }
        .markdown-content :global(th) {
          background: var(--panel-meta-bg);
          font-weight: 600;
          white-space: nowrap;
        }
        .markdown-content :global(blockquote) {
          margin: 12px 0;
          padding: 2px 0 2px 12px;
          border-left: 3px solid var(--border-color);
          color: var(--text-secondary);
        }
        .markdown-content :global(blockquote) :global(p) {
          margin: 4px 0;
        }
        .markdown-content :global(img) {
          max-width: 100%;
          height: auto;
          border-radius: 4px;
        }
        .markdown-content :global(hr) {
          border: none;
          border-top: 1px solid var(--border-color);
          margin: 16px 0;
        }

        /* 모바일: 모달이 화면을 더 채우게 하고, 문서 미리보기 높이도 dvh 기준으로. */
        @media (max-width: 768px) {
          .md-modal {
            width: 94vw;
            max-height: 88dvh;
          }
          .md-modal-preview {
            height: 88dvh;
          }
        }
      `}</style>
    </>
  );
}
