import type { CompileCheck } from "@motion-studio/core";
import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/client/api.ts";

/** Run the server-side TypeScript check for a production and list the diagnostics. */
export default function SourceCheck({
  productionId,
  auto = false,
}: {
  productionId: string;
  auto?: boolean;
}) {
  const [result, setResult] = useState<CompileCheck>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const run = useCallback(async () => {
    setBusy(true);
    setError(undefined);
    try {
      setResult(await api<CompileCheck>("GET", `/api/productions/${productionId}/source-check`));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The check failed");
    } finally {
      setBusy(false);
    }
  }, [productionId]);

  useEffect(() => {
    if (auto) void run();
  }, [auto, run]);

  return (
    <div className="source-check">
      <button type="button" onClick={() => void run()} disabled={busy}>
        {busy ? "Checking source…" : "Check source"}
      </button>
      {error && (
        <div className="form-status" data-tone="error" role="alert">
          {error}
        </div>
      )}
      {result &&
        (result.ok ? (
          <span className="badge" data-tone="ok" role="status">
            {result.files.length} {result.files.length === 1 ? "file" : "files"} type-check cleanly
          </span>
        ) : (
          <ul className="diagnostics" aria-label="Source diagnostics">
            {result.diagnostics.map((diagnostic, index) => (
              <li key={index}>
                {diagnostic.file && (
                  <code>
                    {diagnostic.file}:{diagnostic.line}:{diagnostic.column}
                  </code>
                )}{" "}
                {diagnostic.message}
              </li>
            ))}
          </ul>
        ))}
    </div>
  );
}
