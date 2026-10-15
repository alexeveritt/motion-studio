import { useState, type SubmitEvent } from "react";
import { api } from "../lib/client/api.ts";

type Props = {
  scope: "project" | "campaign" | "production";
  id: string;
  slug: string;
  /** Where to go once archived. */
  redirectTo: string;
  /** Repository-relative archive folder, shown to the operator. */
  archiveFolder: string;
  /** What else moves with it, e.g. "its campaigns and productions". */
  includes?: string;
};

const ENDPOINT = { project: "projects", campaign: "campaigns", production: "productions" } as const;

/** Moves a record folder to the archive. The operator must type the slug to confirm. */
export default function ArchiveButton({
  scope,
  id,
  slug,
  redirectTo,
  archiveFolder,
  includes,
}: Props) {
  const [confirmSlug, setConfirmSlug] = useState("");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: SubmitEvent) {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      const result = await api<{ archivedPath: string }>(
        "DELETE",
        `/api/${ENDPOINT[scope]}/${id}`,
        { confirmSlug },
      );
      window.location.assign(`${redirectTo}?archived=${encodeURIComponent(result.archivedPath)}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Archive failed");
      setBusy(false);
    }
  }

  return (
    <details className="danger-zone">
      <summary>Archive this {scope}</summary>
      <form onSubmit={onSubmit}>
        <p>
          Moves the folder{includes ? `, including ${includes},` : ""} to{" "}
          <code>{archiveFolder}/</code>. Nothing is deleted; you can move it back by hand.
        </p>
        <label>
          Type <code>{slug}</code> to confirm
          <input
            value={confirmSlug}
            onChange={(event) => setConfirmSlug(event.target.value)}
            autoComplete="off"
          />
        </label>
        {error && (
          <div className="form-status" data-tone="error" role="alert">
            {error}
          </div>
        )}
        <button type="submit" className="danger" disabled={busy || confirmSlug !== slug}>
          {busy ? "Archiving…" : `Archive ${scope}`}
        </button>
      </form>
    </details>
  );
}
