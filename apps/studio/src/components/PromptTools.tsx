import type { PromptCandidate } from "@motion-studio/core";
import { useState } from "react";
import { api } from "../lib/client/api.ts";

type Props = { productionId: string };

/**
 * Context packet preview and copy, plus "regenerate prompt from template",
 * which shows a diff and never replaces the saved prompt without a click.
 */
export default function PromptTools({ productionId }: Props) {
  const [packet, setPacket] = useState<string>();
  const [candidate, setCandidate] = useState<PromptCandidate>();
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string }>();
  const [busy, setBusy] = useState(false);

  async function run(task: () => Promise<void>) {
    setBusy(true);
    setMessage(undefined);
    try {
      await task();
    } catch (error) {
      setMessage({
        tone: "error",
        text: error instanceof Error ? error.message : "Something went wrong",
      });
    } finally {
      setBusy(false);
    }
  }

  const loadPacket = () =>
    run(async () => {
      const response = await fetch(`/api/productions/${productionId}/context-packet`);
      if (!response.ok) throw new Error("Could not build the context packet");
      setPacket(await response.text());
    });

  const copyPacket = () =>
    run(async () => {
      const response = await fetch(`/api/productions/${productionId}/context-packet`);
      if (!response.ok) throw new Error("Could not build the context packet");
      const text = await response.text();
      setPacket(text);
      await navigator.clipboard.writeText(text);
      setMessage({
        tone: "ok",
        text: `Copied the context packet (${text.length.toLocaleString("en-GB")} characters)`,
      });
    });

  const regenerate = () =>
    run(async () => {
      setCandidate(
        await api<PromptCandidate>("POST", `/api/productions/${productionId}/prompt-candidate`),
      );
    });

  const replace = () =>
    run(async () => {
      if (!candidate) return;
      if (!window.confirm("Replace the saved prompt.md with the regenerated version?")) return;
      await api("PUT", `/api/documents/production/${productionId}/prompt`, {
        content: candidate.candidate,
        baseHash: candidate.current.hash,
      });
      window.location.reload();
    });

  const changes = candidate?.diff.filter((line) => line.op !== "same").length ?? 0;
  return (
    <section className="panel prompt-tools" aria-label="Claude handoff">
      <div className="section-header">
        <div>
          <h2>Claude handoff</h2>
          <p className="muted">
            The context packet bundles the prompt, brief, project context, assets and commands. It
            is generated from the files each time and never saved.
          </p>
        </div>
      </div>
      <div className="form-actions">
        <button type="button" className="primary" onClick={() => void copyPacket()} disabled={busy}>
          Copy context packet
        </button>
        <button type="button" onClick={() => void loadPacket()} disabled={busy}>
          Preview packet
        </button>
        <button type="button" onClick={() => void regenerate()} disabled={busy}>
          Regenerate prompt from template
        </button>
      </div>
      {message && (
        <div
          className="form-status"
          data-tone={message.tone}
          role={message.tone === "error" ? "alert" : "status"}
        >
          {message.text}
        </div>
      )}

      {candidate && (
        <div className="candidate">
          <h3>Regenerated prompt</h3>
          <p className="muted">
            Saved as a candidate at <code>{candidate.candidatePath}</code>. Your{" "}
            <code>prompt.md</code> is unchanged.
          </p>
          {changes === 0 ? (
            <p>The template matches the saved prompt.</p>
          ) : (
            <>
              <pre className="diff" aria-label="Differences between saved prompt and candidate">
                {candidate.diff.map((line, index) => (
                  <span key={index} data-op={line.op}>
                    {line.op === "add" ? "+ " : line.op === "remove" ? "- " : "  "}
                    {line.text}
                    {"\n"}
                  </span>
                ))}
              </pre>
              <div className="form-actions">
                <button
                  type="button"
                  className="danger"
                  onClick={() => void replace()}
                  disabled={busy}
                >
                  Replace saved prompt
                </button>
                <button type="button" onClick={() => setCandidate(undefined)}>
                  Keep my prompt
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {packet && (
        <details open>
          <summary>Context packet preview ({packet.split("\n").length} lines)</summary>
          <pre className="packet" aria-label="Context packet">
            {packet}
          </pre>
        </details>
      )}
    </section>
  );
}
