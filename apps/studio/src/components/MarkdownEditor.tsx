import { useEffect, useMemo, useRef, useState } from "react";
import { api, ApiError } from "../lib/client/api.ts";
import { renderMarkdown } from "../lib/client/markdown.ts";

type Document = { content: string; hash: string; exists: boolean; path: string };

type Props = {
  scope: "project" | "campaign" | "production";
  id: string;
  kind: string;
  label: string;
  initial: Document;
};

type View = "split" | "edit" | "preview";

export default function MarkdownEditor({ scope, id, kind, label, initial }: Props) {
  const [content, setContent] = useState(initial.content);
  const [saved, setSaved] = useState(initial);
  const [view, setView] = useState<View>("split");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string }>();
  const [conflict, setConflict] = useState(false);
  const textarea = useRef<HTMLTextAreaElement>(null);

  const url = `/api/documents/${scope}/${id}/${kind}`;
  const dirty = content !== saved.content;
  const html = useMemo(() => renderMarkdown(content), [content]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  async function save() {
    if (busy || !dirty) return;
    setBusy(true);
    setMessage(undefined);
    try {
      const result = await api<Document>("PUT", url, { content, baseHash: saved.hash });
      setSaved(result);
      setMessage({ tone: "ok", text: "Saved" });
    } catch (error) {
      if (error instanceof ApiError && error.code === "REVISION_CONFLICT") setConflict(true);
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "Save failed" });
    } finally {
      setBusy(false);
    }
  }

  async function loadLatest() {
    if (dirty && !window.confirm("Discard your unsaved changes and load the version on disk?"))
      return;
    try {
      const latest = await api<Document>("GET", url);
      setSaved(latest);
      setContent(latest.content);
      setConflict(false);
      setMessage({ tone: "ok", text: "Loaded the latest version from disk" });
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "Reload failed" });
    }
  }

  async function copyMine() {
    try {
      await navigator.clipboard.writeText(content);
      setMessage({ tone: "ok", text: "Your text is on the clipboard" });
    } catch {
      setMessage({ tone: "error", text: "Copy failed; select the text and copy it manually" });
    }
  }

  function onKeyDown(event: React.KeyboardEvent) {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
      event.preventDefault();
      void save();
    }
  }

  return (
    <section className="md-editor" aria-label={`${label} editor`} onKeyDown={onKeyDown}>
      <div className="md-toolbar">
        <code className="md-path">{saved.path}</code>
        {!saved.exists && (
          <span className="badge" data-tone="warn">
            new file
          </span>
        )}
        <span className="md-state" aria-live="polite">
          {dirty ? "Unsaved changes" : message?.tone === "ok" ? message.text : ""}
        </span>
        <div className="md-view" role="group" aria-label="View">
          {(["edit", "split", "preview"] as const).map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={view === option}
              onClick={() => setView(option)}
            >
              {option[0]!.toUpperCase() + option.slice(1)}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="primary"
          onClick={() => void save()}
          disabled={busy || !dirty}
        >
          {busy ? "Saving…" : "Save"}
        </button>
      </div>

      {message?.tone === "error" && (
        <div className="form-status" data-tone="error" role="alert">
          {message.text}
          {conflict && (
            <div className="conflict-actions">
              <button type="button" onClick={() => void copyMine()}>
                Copy my text
              </button>
              <button type="button" onClick={() => void loadLatest()}>
                Load latest from disk
              </button>
            </div>
          )}
        </div>
      )}

      <div className="md-panes" data-view={view}>
        {view !== "preview" && (
          <textarea
            ref={textarea}
            className="md-input"
            aria-label={`${label} Markdown`}
            spellCheck
            value={content}
            onChange={(event) => setContent(event.target.value)}
          />
        )}
        {view !== "edit" && (
          // Rendered with raw HTML disabled; see lib/client/markdown.ts.
          <div
            className="md-preview prose"
            aria-label={`${label} preview`}
            dangerouslySetInnerHTML={{ __html: html }}
          />
        )}
      </div>
    </section>
  );
}
