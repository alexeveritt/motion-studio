import type { GoldenFrameResult, GoldenReport, GoldenStatus, JobView } from "@motion-studio/core";
import { formatTimecode } from "@motion-studio/core/time";
import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "../lib/client/api.ts";

type Props = {
  productionId: string;
  fps: number;
  posterFrame: number;
  lastFrame: number;
  initial: GoldenStatus;
};

const STATUS_TONE: Record<GoldenFrameResult["status"], string> = {
  pass: "ok",
  fail: "error",
  "missing-baseline": "warn",
  updated: "ok",
};

const STATUS_LABEL: Record<GoldenFrameResult["status"], string> = {
  pass: "matches",
  fail: "differs",
  "missing-baseline": "no baseline",
  updated: "new baseline",
};

/**
 * Golden-frame checks for one production: render the frames listed in
 * tests/golden.json, compare them with the committed baselines, and show
 * baseline, new frame and difference side by side.
 */
export default function GoldenPanel({ productionId, fps, posterFrame, lastFrame, initial }: Props) {
  const [status, setStatus] = useState(initial);
  const [jobId, setJobId] = useState<string>();
  const [job, setJob] = useState<JobView>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string }>();
  const [onlyChanges, setOnlyChanges] = useState(true);
  const base = `/api/productions/${productionId}/golden`;

  const refresh = useCallback(async () => {
    setStatus(await api<GoldenStatus>("GET", base));
  }, [base]);

  // Follow the frames job, then compare once it finishes.
  useEffect(() => {
    if (!jobId) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      try {
        const view = await api<JobView>("GET", `/api/renders/${jobId}`);
        if (stopped) return;
        setJob(view);
        if (view.state.status !== "running") {
          setJobId(undefined);
          if (view.state.status !== "succeeded") {
            setMessage({
              tone: "error",
              text: `Rendering the frames ${view.state.status}: ${view.state.error?.message ?? "unknown error"}`,
            });
            return;
          }
          const report = await api<GoldenReport>("POST", `${base}/compare`, { renderId: jobId });
          await refresh();
          setMessage(summarise(report));
          return;
        }
      } catch (error) {
        // Keep polling through network blips; stop on a real error such as a failed comparison.
        if (!stopped && !(error instanceof ApiError && error.status === 0)) {
          setJobId(undefined);
          setMessage({ tone: "error", text: error instanceof Error ? error.message : "Failed" });
          return;
        }
      }
      if (!stopped) timer = setTimeout(() => void tick(), 1000);
    };
    timer = setTimeout(() => void tick(), 0);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [jobId, base, refresh]);

  async function run(task: () => Promise<void>): Promise<boolean> {
    setBusy(true);
    setMessage(undefined);
    try {
      await task();
      return true;
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "Failed" });
      return false;
    } finally {
      setBusy(false);
    }
  }

  const start = () =>
    run(async () => {
      const state = await api<JobView["state"]>("POST", base);
      setJob({ state, log: [] });
      setJobId(state.renderId);
    });

  const accept = (frames: number[]) =>
    run(async () => {
      if (!status.latest) return;
      const report = await api<GoldenReport>("POST", `${base}/accept`, {
        renderId: status.latest.renderId,
        frames,
      });
      await refresh();
      setMessage({
        tone: "ok",
        text: `Saved ${frames.length} new baseline${frames.length === 1 ? "" : "s"}. Review them with git diff before committing.`,
      });
      setStatus((current) => ({ ...current, latest: report }));
    });

  const { config, latest } = status;
  const running = Boolean(jobId);
  const missing = status.baselines.filter((baseline) => !baseline.exists).length;
  const changed = latest?.frames.filter((frame) => frame.status === "fail") ?? [];
  const unsaved = latest?.frames.filter((frame) => frame.status === "missing-baseline") ?? [];
  const shown = latest?.frames.filter((frame) => !onlyChanges || frame.status !== "pass") ?? [];

  return (
    <div className="golden-panel">
      <section className="panel" aria-labelledby="golden-heading">
        <h2 id="golden-heading">Golden frames</h2>
        <p className="muted">
          Renders chosen frames and compares them pixel by pixel with committed baselines in{" "}
          <code>tests/golden/</code>, so a change you did not intend shows up before it ships.
        </p>
        {!config && !status.configError && (
          <>
            <p>
              This production has no <code>{status.configPath}</code> yet. Create it, or ask Claude
              Code to, listing the frames to check:
            </p>
            <pre className="json-preview">
              {JSON.stringify(
                { frames: [...new Set([0, posterFrame, lastFrame])].sort((a, b) => a - b) },
                null,
                2,
              )}
            </pre>
            <p className="muted">
              Optional: <code>profileId</code> (default <code>standard</code>) and{" "}
              <code>tolerance</code> (<code>channelThreshold</code>, <code>maxDifferentRatio</code>
              ). Reload this tab once it exists.
            </p>
          </>
        )}
        {status.configError && (
          <div className="form-status" data-tone="error" role="alert">
            {status.configError}
          </div>
        )}
        {config && (
          <>
            <p>
              {config.frames.length} frame{config.frames.length === 1 ? "" : "s"} (
              {config.frames.join(", ")}) at the <code>{config.profileId}</code> profile. A pixel
              differs when a colour channel moves by more than {config.tolerance.channelThreshold};
              a frame matches while at most {formatPercent(config.tolerance.maxDifferentRatio)} of
              its pixels differ.
            </p>
            {missing > 0 && (
              <p className="muted">
                {missing} of {config.frames.length} frames have no baseline yet. Run the check,
                review the frames and save them as baselines.
              </p>
            )}
            <div className="form-actions">
              <button
                type="button"
                className="primary"
                onClick={() => void start()}
                disabled={busy || running}
              >
                {running ? "Checking…" : "Run golden check"}
              </button>
            </div>
          </>
        )}
        {job && running && (
          <div className="job-progress">
            <progress max={1} value={job.state.progress} aria-label="Golden frames progress" />
            <span>
              Rendering {job.state.totalFrames} frames · {Math.round(job.state.progress * 100)}%
            </span>
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

      {latest && (
        <section className="panel" aria-labelledby="golden-report-heading">
          <div className="section-header">
            <h2 id="golden-report-heading">Latest check</h2>
            <span className="badge" data-tone={latest.ok ? "ok" : "error"}>
              {latest.ok ? "all frames match" : "differences found"}
            </span>
          </div>
          <p className="muted">
            {formatWhen(latest.comparedAt)} · <code>{latest.renderId}</code> · {latest.profileId}
          </p>
          <div className="form-actions">
            <label className="checkbox">
              <input
                type="checkbox"
                checked={onlyChanges}
                onChange={(event) => setOnlyChanges(event.target.checked)}
              />
              Only show frames that need attention
            </label>
            {changed.length + unsaved.length > 1 && (
              <ConfirmButton
                label={`Accept all ${changed.length + unsaved.length} as baselines…`}
                confirmLabel={`Save ${changed.length + unsaved.length} baselines`}
                explanation="Replaces the committed baselines with these new frames. Only do this when every change is intended; review with git diff before committing."
                busy={busy}
                onConfirm={() => accept([...changed, ...unsaved].map((frame) => frame.frame))}
              />
            )}
          </div>
          {shown.length === 0 && <p className="muted">Every frame matches its baseline.</p>}
          <ul className="golden-list">
            {shown.map((result) => (
              <GoldenFrame
                key={result.frame}
                result={result}
                fps={fps}
                imageUrl={(kind) =>
                  `${base}/image?kind=${kind}&frame=${result.frame}${kind === "baseline" ? `&v=${encodeURIComponent(latest.comparedAt + result.status)}` : `&renderId=${encodeURIComponent(latest.renderId)}`}`
                }
                busy={busy}
                onAccept={() => accept([result.frame])}
              />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function GoldenFrame({
  result,
  fps,
  imageUrl,
  busy,
  onAccept,
}: {
  result: GoldenFrameResult;
  fps: number;
  imageUrl: (kind: "baseline" | "actual" | "diff") => string;
  busy: boolean;
  onAccept: () => Promise<boolean>;
}) {
  const comparison = result.comparison;
  const images: { kind: "baseline" | "actual" | "diff"; caption: string }[] =
    result.status === "missing-baseline"
      ? [{ kind: "actual", caption: "New frame" }]
      : result.status === "updated"
        ? [{ kind: "baseline", caption: "Baseline (just saved)" }]
        : [
            { kind: "baseline", caption: "Baseline" },
            { kind: "actual", caption: "New frame" },
            ...(result.diff ? [{ kind: "diff" as const, caption: "Difference (red)" }] : []),
          ];
  return (
    <li className="golden-frame" data-status={result.status} aria-label={`Frame ${result.frame}`}>
      <div className="section-header">
        <h3>
          Frame {result.frame} <span className="muted">({formatTimecode(result.frame, fps)})</span>
        </h3>
        <span className="badge" data-tone={STATUS_TONE[result.status]}>
          {STATUS_LABEL[result.status]}
        </span>
      </div>
      {comparison && (
        <p className="muted">
          {comparison.sameSize
            ? `${formatPercent(comparison.differentRatio)} of pixels differ · largest channel change ${comparison.maxChannelDelta}`
            : "The new frame has a different size from the baseline"}
        </p>
      )}
      <div className="golden-images">
        {images.map((image) => (
          <figure key={image.kind}>
            <a href={imageUrl(image.kind)} target="_blank" rel="noreferrer">
              <img
                src={imageUrl(image.kind)}
                alt={`${image.caption}, frame ${result.frame}`}
                loading="lazy"
              />
            </a>
            <figcaption>{image.caption}</figcaption>
          </figure>
        ))}
      </div>
      {(result.status === "fail" || result.status === "missing-baseline") && (
        <ConfirmButton
          label={result.status === "fail" ? "Accept new frame as baseline…" : "Save as baseline…"}
          confirmLabel="Save baseline"
          explanation={`Writes the new frame to ${result.baseline}. Review it with git diff before committing.`}
          busy={busy}
          onConfirm={onAccept}
        />
      )}
    </li>
  );
}

function ConfirmButton({
  label,
  confirmLabel,
  explanation,
  busy,
  onConfirm,
}: {
  label: string;
  confirmLabel: string;
  explanation: string;
  busy: boolean;
  onConfirm: () => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  if (!open)
    return (
      <button type="button" onClick={() => setOpen(true)} disabled={busy}>
        {label}
      </button>
    );
  return (
    <div className="confirm-action">
      <p className="muted">{explanation}</p>
      <div className="form-actions">
        <button
          type="button"
          className="primary"
          disabled={busy}
          onClick={() => void onConfirm().then((ok) => ok && setOpen(false))}
        >
          {confirmLabel}
        </button>
        <button type="button" onClick={() => setOpen(false)} disabled={busy}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function summarise(report: GoldenReport): { tone: "ok" | "error"; text: string } {
  const count = (status: GoldenFrameResult["status"]) =>
    report.frames.filter((frame) => frame.status === status).length;
  if (report.ok) return { tone: "ok", text: `All ${report.frames.length} frames match` };
  const parts = [
    count("fail") && `${count("fail")} differ`,
    count("missing-baseline") && `${count("missing-baseline")} have no baseline`,
  ].filter(Boolean);
  return { tone: "error", text: `Golden check: ${parts.join(", ")}` };
}

function formatPercent(ratio: number): string {
  return `${(ratio * 100).toFixed(ratio < 0.01 ? 2 : 1)} %`;
}

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });
}
