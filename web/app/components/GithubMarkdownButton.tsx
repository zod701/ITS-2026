"use client";

import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

const REPO = "zod701/ITS-2026";
const REPO_URL = `https://github.com/${REPO}`;
const BRANCH = "main";

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
}

export default function GithubMarkdownButton({ filenames, title, icon, style }: Props) {
  const [open, setOpen] = useState(false);
  const [content, setContent] = useState<string | null>(null);
  const [contentError, setContentError] = useState(false);
  const [commit, setCommit] = useState<CommitInfo | null>(null);
  const [commitError, setCommitError] = useState(false);

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
          <div className="md-modal" onClick={(e) => e.stopPropagation()}>
            <div className="md-modal-header">
              <h2>{title}</h2>
              <button onClick={() => setOpen(false)} aria-label="닫기">
                ✕
              </button>
            </div>

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
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
                )}
              </div>
            </div>
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
          width: min(680px, 90vw);
          max-height: 80vh;
          display: flex;
          flex-direction: column;
          overflow: hidden;
          font-family: var(--font-modal), sans-serif;
        }
        .md-modal-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 16px;
          border-bottom: 1px solid var(--border-color);
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
        .md-modal-body {
          padding: 16px;
          overflow-y: auto;
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
      `}</style>
    </>
  );
}
