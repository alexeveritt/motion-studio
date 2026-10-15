import type {
  ApprovalStatus,
  HistoryEntry,
  JobState,
  JobView,
  PreflightResult,
} from "@motion-studio/core";
import { formatBytes } from "@motion-studio/core/media";
import { formatTimecode } from "@motion-studio/core/time";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "../lib/client/api.ts";
import CopyPath from "./CopyPath.tsx";

type Option = { value: string; label: string };

type History = {
  outputs: HistoryEntry[];
  jobs: JobState[];
  problems: string[];
  activeRenderId: string | null;
  approval: ApprovalStatus;
};

type Props = {
  productionId: string;
  productionPath: string;
  profiles: Option[];
  defaultProfileId: string;
  posterFrame: number;
  fps: number;
  lastFrame: number;
  initialHistory: History;
};

const PHASE_LABELS: Record<string, string> = {
  queued: "Queued",
  preflight: "Preflight",
  browser: "Preparing browser",
  bundling: "Bundling",
  checking: "Checking sample frames",
  rendering: "Rendering frames",
  poster: "Rendering poster",
  finalising: "Validating and saving",
  done: "Done",
};

const STATUS_TONE: Record<string, string> = { pass: "ok", warn: "warn", fail: "error" };

/** Preflight, render, progress, cancel and output history for one production. */
export default function RenderPanel(props: Props) {
  const { productionId } = props;
  const [profileId, setProfileId] = useState(props.defaultProfileId);
  const [preflight, setPreflight] = useState<PreflightResult>();
  const [history, setHistory] = useState(props.initialHistory);
  const [activeId, setActiveId] = useState<string | null>(props.initialHistory.activeRenderId);
  const [job, setJob] = useState<JobView>();
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string }>();
  const [busy, setBusy] = useState(false);
  const [starting, setStarting] = useState(false);
  const [posterFrame, setPosterFrame] = useState(String(props.posterFrame));
  const logRef = useRef<HTMLPreElement>(null);

  const refreshHistory = useCallback(async () => {
    const next = await api<History>("GET", `/api/productions/${productionId}/renders`);
    setHistory(next);
    return next;
  }, [productionId]);

  // Poll the active job.
  useEffect(() => {
    if (!activeId) return;
    let stopped = false;
    const tick = async () => {
      try {
        const view = await api<JobView>("GET", `/api/renders/${activeId}`);
        if (stopped) return;
        setJob(view);
        if (view.state.status !== "running") {
          setActiveId(null);
          await refreshHistory();
          setMessage(
            view.state.status === "succeeded"
              ? {
                  tone: "ok",
                  text: view.state.kind === "poster" ? "Poster rendered" : "Render complete",
                }
              : {
                  tone: "error",
                  text: `${capitalise(view.state.status)}: ${view.state.error?.message ?? "unknown error"}`,
                },
          );
          return;
        }
      } catch {
        // Keep polling through transient errors.
      }
      if (!stopped) timer = setTimeout(() => void tick(), 1000);
    };
    let timer = setTimeout(() => void tick(), 0);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [activeId, refreshHistory]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [job?.log.length]);

  /** Run an action, showing its error. Resolves to whether it succeeded. */
  async function run(task: () => Promise<void>): Promise<boolean> {
    setBusy(true);
    setMessage(undefined);
    try {
      await task();
      return true;
    } catch (error) {
      if (error instanceof ApiError && error.body.preflight)
        setPreflight(error.body.preflight as PreflightResult);
      // Someone approved or withdrew elsewhere: show what is on disk now.
      if (error instanceof ApiError && error.code === "REVISION_CONFLICT")
        await refreshHistory().catch(() => undefined);
      setMessage({
        tone: "error",
        text: error instanceof Error ? error.message : "Something went wrong",
      });
      return false;
    } finally {
      setBusy(false);
    }
  }

  const runPreflight = () =>
    run(async () => {
      setPreflight(
        await api<PreflightResult>("POST", `/api/productions/${productionId}/preflight`, {
          profileId,
        }),
      );
    });

  /** The server runs preflight before the job exists, so show that while the request is in flight. */
  const startJob = (url: string, body: Record<string, unknown>) =>
    run(async () => {
      setStarting(true);
      try {
        const state = await api<JobState>("POST", url, body);
        setJob({ state, log: [] });
        setActiveId(state.renderId);
      } finally {
        setStarting(false);
      }
    });

  const startRender = () => startJob(`/api/productions/${productionId}/renders`, { profileId });

  const startPoster = () => {
    const frame = Number(posterFrame);
    return startJob(`/api/productions/${productionId}/poster`, {
      profileId,
      ...(Number.isInteger(frame) ? { frame } : {}),
    });
  };

  const approve = (renderId: string, note: string) =>
    run(async () => {
      const approval = await api<ApprovalStatus>(
        "PUT",
        `/api/productions/${productionId}/approval`,
        { renderId, baseHash: history.approval.hash, ...(note.trim() ? { note } : {}) },
      );
      setHistory((current) => ({ ...current, approval }));
      setMessage({ tone: "ok", text: "Render approved" });
    });

  const withdraw = () =>
    run(async () => {
      const approval = await api<ApprovalStatus>(
        "DELETE",
        `/api/productions/${productionId}/approval`,
        { baseHash: history.approval.hash },
      );
      setHistory((current) => ({ ...current, approval }));
      setMessage({ tone: "ok", text: "Approval withdrawn; the render is kept" });
    });

  const cancel = () =>
    run(async () => {
      if (!activeId) return;
      await api("POST", `/api/renders/${activeId}/cancel`);
      setMessage({ tone: "ok", text: "Cancelling…" });
    });

  const running = Boolean(activeId);
  const state = job?.state;
  return (
    <div className="render-panel">
      <section className="panel" aria-labelledby="render-heading">
        <h2 id="render-heading">Render</h2>
        <div className="render-controls">
          <label className="field">
            <span>Profile</span>
            <select
              value={profileId}
              onChange={(event) => setProfileId(event.target.value)}
              disabled={running}
            >
              {props.profiles.map((profile) => (
                <option key={profile.value} value={profile.value}>
                  {profile.label}
                </option>
              ))}
            </select>
          </label>
          <button type="button" onClick={() => void runPreflight()} disabled={busy}>
            Run preflight
          </button>
          <button
            type="button"
            className="primary"
            onClick={() => void startRender()}
            disabled={busy || running}
          >
            Render MP4 and poster
          </button>
          <label className="field poster-frame">
            <span>Poster frame</span>
            <input
              type="number"
              min={0}
              max={props.lastFrame}
              value={posterFrame}
              onChange={(event) => setPosterFrame(event.target.value)}
              disabled={running}
            />
          </label>
          <button type="button" onClick={() => void startPoster()} disabled={busy || running}>
            Render poster only
          </button>
        </div>
        <p className="muted">
          Every render runs preflight first, then renders sample frames to catch runtime errors
          before the full render.
        </p>
        {starting && (
          <div className="form-status" role="status">
            Running preflight checks…
          </div>
        )}
        {message && (
          <div
            className="form-status"
            data-tone={message.tone}
            role={message.tone === "error" ? "alert" : "status"}
          >
            {message.text}
          </div>
        )}
      </section>

      {preflight && <PreflightReport result={preflight} />}

      {state && (
        <section className="panel job" aria-labelledby="job-heading" aria-live="polite">
          <div className="section-header">
            <h2 id="job-heading">
              {state.kind === "poster" ? "Poster" : "Render"} <code>{state.renderId}</code>
            </h2>
            <span
              className="badge"
              data-tone={
                state.status === "succeeded" ? "ok" : state.status === "running" ? "warn" : "error"
              }
            >
              {state.status}
            </span>
          </div>
          <div className="job-progress">
            <progress max={1} value={state.progress} aria-label="Render progress" />
            <span>
              {PHASE_LABELS[state.phase] ?? state.phase} · {Math.round(state.progress * 100)}%
              {state.renderedFrames !== undefined &&
                ` · ${state.renderedFrames}/${state.totalFrames} frames`}
            </span>
            {state.status === "running" && (
              <button
                type="button"
                className="danger"
                onClick={() => void cancel()}
                disabled={busy}
              >
                Cancel
              </button>
            )}
          </div>
          {state.error && <p className="field-error">{state.error.message}</p>}
          <details open={state.status !== "succeeded"}>
            <summary>Log</summary>
            <pre className="job-log" ref={logRef} aria-label="Render log">
              {job.log.join("\n") || "Waiting for output…"}
            </pre>
          </details>
        </section>
      )}

      <section className="panel" aria-labelledby="history-heading">
        <h2 id="history-heading">Outputs</h2>
        <ApprovalSummary status={history.approval} busy={busy} onWithdraw={() => void withdraw()} />
        {history.problems.map((problem) => (
          <p key={problem} className="field-error">
            {problem}
          </p>
        ))}
        {history.outputs.length === 0 ? (
          <p className="muted">
            No successful renders yet. Outputs land in {props.productionPath}/renders/final.
          </p>
        ) : (
          <ul className="output-list">
            {history.outputs.map((entry) => (
              <OutputItem
                key={entry.manifest.renderId + entry.kind}
                entry={entry}
                productionId={productionId}
                fps={props.fps}
                approval={history.approval}
                busy={busy}
                onApprove={(note) => approve(entry.manifest.renderId, note)}
              />
            ))}
          </ul>
        )}
        {history.jobs.length > 0 && (
          <>
            <h3>Unsuccessful jobs</h3>
            <ul className="job-list">
              {history.jobs.map((failed) => (
                <li key={failed.renderId}>
                  <span
                    className="badge"
                    data-tone={failed.status === "running" ? "warn" : "error"}
                  >
                    {failed.status}
                  </span>{" "}
                  <code>{failed.renderId}</code> {failed.error?.message}
                  <div className="muted">Log: .motion-studio/jobs/{failed.renderId}/log.txt</div>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
    </div>
  );
}

function PreflightReport({ result }: { result: PreflightResult }) {
  return (
    <section className="panel" aria-labelledby="preflight-heading">
      <div className="section-header">
        <h2 id="preflight-heading">Preflight</h2>
        <span className="badge" data-tone={result.ok ? "ok" : "error"}>
          {result.ok ? "ready to render" : "blocked"}
        </span>
      </div>
      <ul className="check-list" aria-label="Preflight checks">
        {result.checks.map((check) => (
          <li key={check.id} data-status={check.status}>
            <span className="badge" data-tone={STATUS_TONE[check.status]}>
              {check.status}
            </span>{" "}
            <strong>{check.label}</strong>
            {check.messages.length > 0 && (
              <ul>
                {check.messages.map((text, index) => (
                  <li key={index}>{text}</li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
      {result.output && (
        <p className="muted">
          Output {result.output.width}×{result.output.height}, {result.output.fps} fps,{" "}
          {result.output.durationInFrames} frames.
        </p>
      )}
    </section>
  );
}

const APPROVAL_TONE: Record<ApprovalStatus["state"], string> = {
  none: "",
  current: "ok",
  outdated: "warn",
  broken: "error",
};

const APPROVAL_LABEL: Record<ApprovalStatus["state"], string> = {
  none: "none",
  current: "approved",
  outdated: "approved, inputs changed since",
  broken: "approval broken",
};

/** Which render is the approved final, and whether it still holds. */
function ApprovalSummary({
  status,
  busy,
  onWithdraw,
}: {
  status: ApprovalStatus;
  busy: boolean;
  onWithdraw: () => void;
}) {
  const approval = status.approval;
  return (
    <div className="approval-summary" data-state={status.state} aria-label="Approved render">
      <div className="section-header">
        <h3>Approved final</h3>
        {status.state !== "none" && (
          <span className="badge" data-tone={APPROVAL_TONE[status.state]}>
            {APPROVAL_LABEL[status.state]}
          </span>
        )}
      </div>
      {status.state === "none" ? (
        <p className="muted">
          No render is approved yet. Press <strong>Approve as final</strong> on the video to
          publish; it is recorded in <code>{status.path}</code>.
        </p>
      ) : (
        <>
          {approval && (
            <>
              <p>
                <code>{approval.renderId}</code> · {approval.profileId} · approved{" "}
                {formatWhen(approval.approvedAt)}
              </p>
              {approval.note && <p className="approval-note">{approval.note}</p>}
              <CopyPath
                path={`${status.path.slice(0, -"renders/approved.json".length)}${approval.video.relativePath}`}
              />
            </>
          )}
          {status.problems.map((problem) => (
            <p key={problem} className={status.state === "broken" ? "field-error" : "muted"}>
              {problem}
            </p>
          ))}
          <div className="form-actions">
            <button type="button" onClick={onWithdraw} disabled={busy}>
              Withdraw approval
            </button>
            <span className="muted">
              Commit <code>renders/approved.json</code> with the approved video, poster and
              manifest.
            </span>
          </div>
        </>
      )}
    </div>
  );
}

function ApproveControl({
  replacing,
  busy,
  onApprove,
}: {
  replacing: string | undefined;
  busy: boolean;
  onApprove: (note: string) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  if (!open)
    return (
      <div className="form-actions">
        <button type="button" onClick={() => setOpen(true)} disabled={busy}>
          Approve as final
        </button>
      </div>
    );
  return (
    <div className="approve-form">
      <label className="field">
        <span>Approval note (optional)</span>
        <textarea
          rows={2}
          maxLength={1000}
          value={note}
          placeholder="Who approved it, for which channel"
          onChange={(event) => setNote(event.target.value)}
        />
      </label>
      {replacing && (
        <p className="muted">
          This replaces the approval of <code>{replacing}</code>. That render is kept.
        </p>
      )}
      <div className="form-actions">
        <button
          type="button"
          className="primary"
          disabled={busy}
          onClick={() => void onApprove(note).then((ok) => ok && setOpen(false))}
        >
          Confirm approval
        </button>
        <button type="button" onClick={() => setOpen(false)} disabled={busy}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function OutputItem({
  entry,
  productionId,
  fps,
  approval,
  busy,
  onApprove,
}: {
  entry: HistoryEntry;
  productionId: string;
  fps: number;
  approval: ApprovalStatus;
  busy: boolean;
  onApprove: (note: string) => Promise<boolean>;
}) {
  const manifest = entry.manifest;
  const approved = entry.kind === "render" && approval.approval?.renderId === manifest.renderId;
  const url = (relativePath: string) =>
    `/api/productions/${productionId}/outputs/${encodeURIComponent(relativePath.split("/").pop()!)}`;
  const posterUrl = manifest.poster ? url(manifest.poster.relativePath) : undefined;
  const when = formatWhen(manifest.completedAt);
  return (
    <li className="output-item" data-approved={approved ? "" : undefined}>
      <div className="output-media">
        {entry.kind === "render" ? (
          <video
            controls
            preload="metadata"
            src={url(entry.manifest.video.relativePath)}
            poster={posterUrl}
          />
        ) : (
          posterUrl && <img src={posterUrl} alt={`Poster frame ${entry.manifest.poster.frame}`} />
        )}
      </div>
      <div className="output-details">
        <div>
          <strong>{entry.kind === "render" ? "Video" : "Poster"}</strong> · {manifest.profileId} ·{" "}
          {when}
          {approved && (
            <>
              {" "}
              <span className="badge" data-tone={APPROVAL_TONE[approval.state]}>
                Approved final
              </span>
            </>
          )}
        </div>
        {entry.kind === "render" ? (
          <div className="muted">
            {entry.manifest.video.width}×{entry.manifest.video.height} · {entry.manifest.video.fps}{" "}
            fps · {entry.manifest.video.durationInFrames} frames (
            {entry.manifest.video.durationSeconds.toFixed(2)} s) · {entry.manifest.video.codec}/
            {entry.manifest.video.pixelFormat} · {formatBytes(entry.manifest.video.bytes)}
          </div>
        ) : (
          <div className="muted">
            Frame {entry.manifest.poster.frame} ({formatTimecode(entry.manifest.poster.frame, fps)})
            · {entry.manifest.poster.width}×{entry.manifest.poster.height}
          </div>
        )}
        {entry.kind === "render" && manifest.poster && (
          <div className="muted">
            Poster frame {manifest.poster.frame} ({formatTimecode(manifest.poster.frame, fps)})
          </div>
        )}
        <div className="muted">
          Fingerprint{" "}
          <code title={manifest.inputFingerprint}>{manifest.inputFingerprint.slice(0, 12)}</code>
          {manifest.git && (
            <>
              {" "}
              · commit <code>{manifest.git.commit?.slice(0, 10) ?? "none"}</code>
              {manifest.git.dirty && (
                <span className="badge" data-tone="warn">
                  uncommitted changes
                </span>
              )}
            </>
          )}
        </div>
        {manifest.warnings.length > 0 && (
          <div className="muted">{manifest.warnings.length} warning(s) recorded</div>
        )}
        <CopyPath path={entry.manifestPath} />
        {entry.kind === "render" && !approved && (
          <ApproveControl
            replacing={approval.approval?.renderId}
            busy={busy}
            onApprove={onApprove}
          />
        )}
      </div>
    </li>
  );
}

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
