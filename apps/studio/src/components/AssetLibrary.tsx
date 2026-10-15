import type { AssetEntry, AssetListing } from "@motion-studio/core";
import { formatBytes } from "@motion-studio/core/media";
import { useRef, useState, type DragEvent, type SubmitEvent } from "react";
import { api, ApiError } from "../lib/client/api.ts";
import CopyPath from "./CopyPath.tsx";

type Props = {
  scope: AssetListing["scope"];
  id: string;
  title: string;
  description?: string;
  initial: AssetListing;
  maxUploadBytes: number;
};

type UploadRow = {
  key: string;
  name: string;
  progress: number;
  state: "uploading" | "done" | "error";
  message?: string;
};

/** Upload, inspect and manage the assets in one folder. */
export default function AssetLibrary({
  scope,
  id,
  title,
  description,
  initial,
  maxUploadBytes,
}: Props) {
  const [listing, setListing] = useState(initial);
  const [uploads, setUploads] = useState<UploadRow[]>([]);
  const [dragging, setDragging] = useState(false);
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string }>();
  const input = useRef<HTMLInputElement>(null);
  const base = `/api/assets/${scope}/${id}`;

  async function refresh() {
    setListing(await api<AssetListing>("GET", base));
  }

  function patchUpload(key: string, patch: Partial<UploadRow>) {
    setUploads((rows) => rows.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  }

  async function uploadFiles(files: File[]) {
    const rows = files.map((file, index) => ({
      key: `${Date.now()}-${index}`,
      name: file.name,
      progress: 0,
      state: "uploading" as const,
    }));
    setUploads((existing) => [...rows, ...existing.filter((row) => row.state === "uploading")]);
    // One at a time keeps duplicate detection and progress easy to follow.
    for (const [index, file] of files.entries()) {
      const key = rows[index]!.key;
      if (file.size > maxUploadBytes) {
        patchUpload(key, {
          state: "error",
          message: `Larger than the ${formatBytes(maxUploadBytes)} upload limit`,
        });
        continue;
      }
      try {
        await sendFile(file, (progress) => patchUpload(key, { progress }));
        patchUpload(key, { state: "done", progress: 1 });
        await refresh();
      } catch (error) {
        patchUpload(key, {
          state: "error",
          message: error instanceof Error ? error.message : "Upload failed",
        });
      }
    }
  }

  function sendFile(file: File, onProgress: (fraction: number) => void): Promise<void> {
    // XMLHttpRequest rather than fetch, for upload progress events.
    return new Promise((resolve, reject) => {
      const request = new XMLHttpRequest();
      request.open("POST", base);
      request.setRequestHeader("Content-Type", "application/octet-stream");
      request.setRequestHeader("X-File-Name", encodeURIComponent(file.name));
      request.upload.onprogress = (event) =>
        event.lengthComputable && onProgress(event.loaded / event.total);
      request.onerror = () => reject(new Error("Could not reach the studio server"));
      request.onload = () => {
        if (request.status >= 200 && request.status < 300) return resolve();
        try {
          reject(
            new Error(
              (JSON.parse(request.responseText) as { error: { message: string } }).error.message,
            ),
          );
        } catch {
          reject(new Error(`Upload failed (${request.status})`));
        }
      };
      request.send(file);
    });
  }

  function onDrop(event: DragEvent) {
    event.preventDefault();
    setDragging(false);
    const files = [...event.dataTransfer.files];
    if (files.length > 0) void uploadFiles(files);
  }

  async function register(fileName: string) {
    setNotice(undefined);
    try {
      await api("POST", `${base}/register`, { fileName });
      await refresh();
      setNotice({ tone: "ok", text: `Registered ${fileName}` });
    } catch (error) {
      setNotice({
        tone: "error",
        text: error instanceof Error ? error.message : "Register failed",
      });
    }
  }

  const headingId = `assets-${scope}-${id}`;
  return (
    <section className="panel asset-library" aria-labelledby={headingId}>
      <div className="section-header">
        <div>
          <h2 id={headingId}>{title}</h2>
          {description && <p className="muted">{description}</p>}
          <CopyPath path={`${listing.folder}/`} />
        </div>
      </div>

      <div
        className="drop-zone"
        data-dragging={dragging ? "" : undefined}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        <p>
          Drop files here or{" "}
          <button type="button" onClick={() => input.current?.click()}>
            choose files
          </button>
        </p>
        <p className="muted">
          Images, audio, video, fonts, PDF and text up to {formatBytes(maxUploadBytes)}. Types are
          checked from the file contents.
        </p>
        <input
          ref={input}
          type="file"
          multiple
          hidden
          aria-label={`Upload to ${title}`}
          onChange={(event) => {
            const files = [...(event.target.files ?? [])];
            event.target.value = "";
            if (files.length > 0) void uploadFiles(files);
          }}
        />
      </div>

      {uploads.length > 0 && (
        <ul className="upload-list" aria-live="polite">
          {uploads.map((row) => (
            <li key={row.key} data-state={row.state}>
              <span>{row.name}</span>
              {row.state === "uploading" && (
                <progress max={1} value={row.progress} aria-label={`Uploading ${row.name}`} />
              )}
              {row.state === "done" && (
                <span className="badge" data-tone="ok">
                  uploaded
                </span>
              )}
              {row.state === "error" && (
                <span className="field-error" role="alert">
                  {row.message}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      {notice && (
        <div
          className="form-status"
          data-tone={notice.tone}
          role={notice.tone === "error" ? "alert" : "status"}
        >
          {notice.text}
        </div>
      )}

      {listing.problems.length > 0 && (
        <ul className="problem-list">
          {listing.problems.map((problem) => (
            <li key={problem.path}>
              <span className="badge" data-tone="error">
                problem
              </span>{" "}
              <code>{problem.path}</code> {problem.message}
            </li>
          ))}
        </ul>
      )}

      {listing.unregistered.length > 0 && (
        <div className="unregistered">
          <h3>Files without metadata</h3>
          <p className="muted">
            These were added to the folder directly. Register them to record their type and hash.
          </p>
          <ul>
            {listing.unregistered.map((file) => (
              <li key={file.name}>
                <code>{file.name}</code>{" "}
                <button type="button" onClick={() => void register(file.name)}>
                  Register
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {listing.assets.length === 0 ? (
        <p className="muted">No assets yet.</p>
      ) : (
        <ul className="asset-grid">
          {listing.assets.map((asset) => (
            <AssetCard key={asset.record.id} asset={asset} base={base} onChange={refresh} />
          ))}
        </ul>
      )}
    </section>
  );
}

function AssetCard({
  asset,
  base,
  onChange,
}: {
  asset: AssetEntry;
  base: string;
  onChange: () => Promise<void>;
}) {
  const { record } = asset;
  const url = `${base}/${record.id}`;
  const [altText, setAltText] = useState(record.altText ?? "");
  const [source, setSource] = useState(record.source ?? "");
  const [licenceNotes, setLicenceNotes] = useState(record.licenceNotes ?? "");
  const [confirmName, setConfirmName] = useState("");
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string }>();
  const [busy, setBusy] = useState(false);

  async function save(event: SubmitEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      await api("PATCH", url, { baseHash: asset.sidecarHash, altText, source, licenceNotes });
      await onChange();
      setMessage({ tone: "ok", text: "Saved" });
    } catch (error) {
      setMessage({
        tone: "error",
        text: error instanceof ApiError ? error.message : "Save failed",
      });
    } finally {
      setBusy(false);
    }
  }

  async function archive(event: SubmitEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      await api("DELETE", url, { confirmName });
      await onChange();
    } catch (error) {
      setMessage({
        tone: "error",
        text: error instanceof ApiError ? error.message : "Archive failed",
      });
      setBusy(false);
    }
  }

  const statusTone = asset.status === "ok" ? "ok" : "error";
  return (
    <li className="asset-card">
      <div className="asset-thumb">
        {record.mediaType === "image" && asset.status !== "missing" ? (
          <img src={`${url}/file`} alt={record.altText ?? ""} loading="lazy" />
        ) : (
          <span className="asset-type">{record.mimeType}</span>
        )}
      </div>
      <div className="asset-body">
        <div className="asset-title">
          <strong>{record.storedName}</strong>
          <span className="badge" data-tone={statusTone}>
            {asset.status}
          </span>
        </div>
        {record.originalName !== record.storedName && (
          <div className="muted">Uploaded as {record.originalName}</div>
        )}
        <div className="muted">
          {record.mimeType}
          {record.width && record.height ? ` · ${record.width}×${record.height}` : ""} ·{" "}
          {formatBytes(record.bytes)}
        </div>
        <CopyPath path={asset.path} />
        <div className="asset-hash">
          SHA-256 <CopyPath path={record.sha256} label={`${record.sha256.slice(0, 16)}…`} />
        </div>
        <div className="asset-usage">
          {asset.usage.length === 0 ? (
            <span className="muted">Not referenced by any composition source yet.</span>
          ) : (
            <>
              Used by:
              <ul>
                {asset.usage.map((file) => (
                  <li key={file}>
                    <code>{file}</code>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
        {asset.status === "modified" && (
          <p className="field-error">
            The file changed after upload. Its hash no longer matches. Upload it again as a new
            asset.
          </p>
        )}

        <details>
          <summary>Details</summary>
          <form className="record-form" onSubmit={(event) => void save(event)}>
            <label className="field">
              <span>Alt text</span>
              <input value={altText} onChange={(event) => setAltText(event.target.value)} />
            </label>
            <label className="field">
              <span>Source</span>
              <input value={source} onChange={(event) => setSource(event.target.value)} />
            </label>
            <label className="field">
              <span>Licence notes</span>
              <textarea
                rows={2}
                value={licenceNotes}
                onChange={(event) => setLicenceNotes(event.target.value)}
              />
            </label>
            <button type="submit" disabled={busy}>
              Save details
            </button>
          </form>
        </details>

        <details className="danger-zone">
          <summary>Archive</summary>
          {asset.usage.length > 0 ? (
            <p className="muted">Remove the references above before archiving this asset.</p>
          ) : (
            <form onSubmit={(event) => void archive(event)}>
              <label>
                Type <code>{record.storedName}</code> to confirm
                <input
                  value={confirmName}
                  onChange={(event) => setConfirmName(event.target.value)}
                  autoComplete="off"
                />
              </label>
              <button
                type="submit"
                className="danger"
                disabled={busy || confirmName !== record.storedName}
              >
                Archive asset
              </button>
            </form>
          )}
        </details>

        {message && (
          <div
            className="form-status"
            data-tone={message.tone}
            role={message.tone === "error" ? "alert" : "status"}
          >
            {message.text}
          </div>
        )}
      </div>
    </li>
  );
}
