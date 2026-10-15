import { formatTimecode } from "@motion-studio/core/time";
import {
  AssetResolverProvider,
  resolveInputProps,
  validateComposition,
  type AssetScopeName,
  type MotionStudioComposition,
} from "@motion-studio/motion-runtime";
import { Player, type PlayerRef } from "@remotion/player";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type KeyboardEvent,
} from "react";
import { registry } from "virtual:motion-studio/registry";
import { api } from "../lib/client/api.ts";
import { redactPaths } from "../lib/client/redact.ts";
import SourceCheck from "./SourceCheck.tsx";

type Format = { width: number; height: number; fps: number; durationInFrames: number };

type Props = {
  productionId: string;
  compositionId: string;
  entryPath: string;
  format: Format;
  posterFrame: number;
  productionProps: Record<string, unknown>;
  propsPath: string;
  propsError?: string;
  /** Whether the entry file exists on disk, as seen by the server when the page was rendered. */
  registered: boolean;
};

type Zoom = "fit" | "0.5" | "1";

function initialFrameFromUrl(durationInFrames: number): number {
  const value = Number(new URLSearchParams(window.location.search).get("frame"));
  return Number.isInteger(value) && value >= 0 && value < durationInFrames ? value : 0;
}

/**
 * Remotion Player for one production, loaded through the generated registry.
 * Uses the same input props and asset resolver contract as headless rendering.
 */
export default function ProductionPreview(props: Props) {
  const { productionId, compositionId, entryPath } = props;
  const entry = registry[compositionId];
  const [composition, setComposition] = useState<MotionStudioComposition>();
  const [loadError, setLoadError] = useState<string>();
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!entry) return;
    let cancelled = false;
    setLoadError(undefined);
    entry
      .load()
      .then((module) => {
        if (cancelled) return;
        setComposition(validateComposition(module, compositionId, entryPath));
        sessionStorageSet("motion-studio:registry-reload", "");
      })
      .catch((error: unknown) => {
        if (!cancelled)
          setLoadError(redactPaths(error instanceof Error ? error.message : String(error)));
      });
    return () => {
      cancelled = true;
    };
  }, [entry, compositionId, entryPath, attempt]);

  if (!props.registered) return <MissingEntry productionId={productionId} entryPath={entryPath} />;
  // The server just added this entry; the dev server pushes the new registry module shortly.
  if (!entry) return <RegistryCatchUp />;
  if (loadError) {
    return (
      <div className="preview">
        <ErrorPanel
          title="The composition could not be loaded"
          message={loadError}
          onRetry={() => setAttempt((n) => n + 1)}
        />
        <SourceCheck productionId={productionId} auto />
      </div>
    );
  }
  if (!composition) return <div className="preview-status">Loading composition…</div>;
  return <PlayerWithControls {...props} composition={composition} />;
}

function PlayerWithControls({
  productionId,
  composition,
  format,
  posterFrame,
  productionProps,
  propsPath,
  propsError,
}: Props & { composition: MotionStudioComposition }) {
  const { width, height, fps, durationInFrames } = format;
  const lastFrame = durationInFrames - 1;
  const player = useRef<PlayerRef>(null);
  const [frame, setFrame] = useState(() => initialFrameFromUrl(durationInFrames));
  const [frameInput, setFrameInput] = useState(String(frame));
  const [playing, setPlaying] = useState(false);
  const [loop, setLoop] = useState(false);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [zoom, setZoom] = useState<Zoom>("fit");
  const [playerKey, setPlayerKey] = useState(0);

  // Wrap the composition so useAsset() resolves through the studio for this production.
  const Component = useMemo(() => {
    const Inner = composition.Component as ComponentType<Record<string, unknown>>;
    const resolve = (scope: AssetScopeName, name: string) =>
      `/api/productions/${productionId}/asset/${scope}/${encodeURIComponent(name)}`;
    function WithRuntime(componentProps: Record<string, unknown>) {
      return (
        <AssetResolverProvider resolve={resolve}>
          <Inner {...componentProps} />
        </AssetResolverProvider>
      );
    }
    return WithRuntime;
  }, [composition, productionId]);
  const inputProps = useMemo(
    () => resolveInputProps(composition, productionProps),
    [composition, productionProps],
  );

  useEffect(() => {
    const instance = player.current;
    if (!instance) return;
    const onFrame = (event: { detail: { frame: number } }) => setFrame(event.detail.frame);
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    instance.addEventListener("frameupdate", onFrame);
    instance.addEventListener("seeked", onFrame);
    instance.addEventListener("play", onPlay);
    instance.addEventListener("pause", onPause);
    instance.addEventListener("ended", onPause);
    return () => {
      instance.removeEventListener("frameupdate", onFrame);
      instance.removeEventListener("seeked", onFrame);
      instance.removeEventListener("play", onPlay);
      instance.removeEventListener("pause", onPause);
      instance.removeEventListener("ended", onPause);
    };
  }, [playerKey]);

  useEffect(() => {
    setFrameInput(String(frame));
    if (playing) return;
    // Remember the paused frame so a reload (e.g. after a source edit) returns to it.
    const url = new URL(window.location.href);
    url.searchParams.set("frame", String(frame));
    window.history.replaceState(null, "", url);
  }, [frame, playing]);

  const seek = useCallback(
    (target: number) => {
      const clamped = Math.min(Math.max(Math.round(target), 0), lastFrame);
      player.current?.pause();
      player.current?.seekTo(clamped);
      setFrame(clamped);
      // Also reset the entry field: when clamping lands on the current frame, `frame` does not change.
      setFrameInput(String(clamped));
    },
    [lastFrame],
  );

  function onKeyDown(event: KeyboardEvent) {
    if ((event.target as HTMLElement).closest("input, select, textarea")) return;
    const step = event.shiftKey ? fps : 1;
    const actions: Record<string, () => void> = {
      ArrowLeft: () => seek(frame - step),
      ArrowRight: () => seek(frame + step),
      Home: () => seek(0),
      End: () => seek(lastFrame),
      " ": () => player.current?.toggle(),
      k: () => player.current?.toggle(),
    };
    const action = actions[event.key];
    if (action) {
      event.preventDefault();
      action();
    }
  }

  const scale = zoom === "fit" ? undefined : Number(zoom);
  return (
    <section className="preview" aria-label="Preview">
      {propsError && (
        <div className="form-status" data-tone="error" role="alert">
          <code>{propsPath}</code>: {propsError}. Previewing with the composition defaults.
        </div>
      )}
      <div
        className="preview-stage"
        data-zoom={zoom}
        tabIndex={0}
        onKeyDown={onKeyDown}
        aria-label="Player. Arrow keys step frames."
      >
        <div
          className="preview-frame"
          style={
            scale
              ? { width: width * scale, height: height * scale }
              : { aspectRatio: `${width} / ${height}` }
          }
        >
          <Player
            key={playerKey}
            ref={player}
            component={Component}
            inputProps={inputProps}
            durationInFrames={durationInFrames}
            fps={fps}
            compositionWidth={width}
            compositionHeight={height}
            initialFrame={frame}
            controls={false}
            loop={loop}
            clickToPlay={false}
            doubleClickToFullscreen={false}
            spaceKeyToPlayOrPause={false}
            moveToBeginningWhenEnded={false}
            initiallyMuted={muted}
            style={{ width: "100%", height: "100%" }}
            errorFallback={({ error }) => (
              <ErrorPanel
                title="The composition threw an error"
                message={redactPaths(error.message)}
                onRetry={() => setPlayerKey((n) => n + 1)}
              />
            )}
          />
        </div>
      </div>

      <div className="preview-controls" role="toolbar" aria-label="Playback controls">
        <button type="button" onClick={() => seek(0)} aria-label="First frame">
          ⏮
        </button>
        <button type="button" onClick={() => seek(frame - 1)} aria-label="Previous frame">
          −1
        </button>
        <button
          type="button"
          className="primary"
          onClick={() => player.current?.toggle()}
          aria-label={playing ? "Pause" : "Play"}
        >
          {playing ? "Pause" : "Play"}
        </button>
        <button type="button" onClick={() => seek(frame + 1)} aria-label="Next frame">
          +1
        </button>
        <button type="button" onClick={() => seek(lastFrame)} aria-label="Last frame">
          ⏭
        </button>

        <form
          className="frame-entry"
          // Out-of-range entries are clamped by seek(), not blocked by the browser.
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            const target = Number(frameInput);
            if (Number.isInteger(target)) seek(target);
            else setFrameInput(String(frame));
          }}
        >
          <label>
            Frame
            <input
              type="number"
              inputMode="numeric"
              min={0}
              max={lastFrame}
              value={frameInput}
              onChange={(event) => setFrameInput(event.target.value)}
              onBlur={() => setFrameInput(String(frame))}
            />
          </label>
          <span className="muted">/ {lastFrame}</span>
        </form>
        <output className="timecode" aria-label="Timecode">
          {formatTimecode(frame, fps)}
        </output>

        <button type="button" onClick={() => seek(posterFrame)}>
          Poster frame ({posterFrame})
        </button>
      </div>

      <input
        className="scrubber"
        type="range"
        min={0}
        max={lastFrame}
        step={1}
        value={frame}
        aria-label="Scrubber"
        aria-valuetext={`Frame ${frame}, ${formatTimecode(frame, fps)}`}
        onChange={(event) => seek(Number(event.target.value))}
      />

      <div className="preview-options">
        <label>
          <input
            type="checkbox"
            checked={loop}
            onChange={(event) => setLoop(event.target.checked)}
          />{" "}
          Loop
        </label>
        <label>
          Volume
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={muted ? 0 : volume}
            aria-label="Volume"
            onChange={(event) => {
              const next = Number(event.target.value);
              setVolume(next);
              setMuted(next === 0);
              player.current?.setVolume(next);
              if (next === 0) player.current?.mute();
              else player.current?.unmute();
            }}
          />
        </label>
        <button
          type="button"
          aria-pressed={muted}
          onClick={() => {
            if (muted) player.current?.unmute();
            else player.current?.mute();
            setMuted(!muted);
          }}
        >
          {muted ? "Unmute" : "Mute"}
        </button>
        <div role="group" aria-label="Zoom" className="zoom">
          {(
            [
              ["fit", "Fit"],
              ["0.5", "50%"],
              ["1", "100%"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={zoom === value}
              onClick={() => setZoom(value)}
            >
              {label}
            </button>
          ))}
        </div>
        <SourceCheck productionId={productionId} />
        <span className="muted">
          {width}×{height} · {fps} fps · {durationInFrames} frames · ← → step, Shift+← → 1 s, Space
          play
        </span>
      </div>
    </section>
  );
}

/** Shown while the dev server delivers a freshly generated registry. Reloads once as a fallback. */
function RegistryCatchUp() {
  useEffect(() => {
    const key = "motion-studio:registry-reload";
    if (sessionStorageGet(key)) return;
    const timer = setTimeout(() => {
      sessionStorageSet(key, "1");
      window.location.reload();
    }, 2000);
    return () => clearTimeout(timer);
  }, []);
  return <div className="preview-status">Updating the composition registry…</div>;
}

function sessionStorageGet(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function sessionStorageSet(key: string, value: string): void {
  try {
    sessionStorage.setItem(key, value);
  } catch {
    // Storage may be unavailable; the reload still happens once per timer.
  }
}

function ErrorPanel({
  title,
  message,
  onRetry,
}: {
  title: string;
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="preview-error" role="alert">
      <h3>{title}</h3>
      <pre>{message}</pre>
      <p>
        Fix the source and save; the preview reloads automatically. Rendering stays blocked while
        this error remains.
      </p>
      <button type="button" onClick={onRetry}>
        Try again
      </button>
    </div>
  );
}

function MissingEntry({ productionId, entryPath }: { productionId: string; entryPath: string }) {
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  return (
    <div className="panel preview-status">
      <h3>No composition yet</h3>
      <p>
        <code>{entryPath}</code> does not exist. Create a placeholder to preview straight away, or
        ask Claude Code to implement it from the Prompt tab.
      </p>
      {error && (
        <div className="form-status" data-tone="error" role="alert">
          {error}
        </div>
      )}
      <button
        type="button"
        className="primary"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await api("POST", `/api/productions/${productionId}/composition`);
            window.location.reload();
          } catch (caught) {
            setError(caught instanceof Error ? caught.message : "Could not create the placeholder");
            setBusy(false);
          }
        }}
      >
        Create placeholder composition
      </button>
    </div>
  );
}
