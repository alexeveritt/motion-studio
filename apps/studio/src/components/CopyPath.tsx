import { useState } from "react";

type Props = { path: string };

/** Shows a repository-relative path with a copy button. Never exposes absolute paths. */
export default function CopyPath({ path }: Props) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");

  async function copy() {
    try {
      await navigator.clipboard.writeText(path);
      setState("copied");
    } catch {
      setState("failed");
    }
    setTimeout(() => setState("idle"), 1500);
  }

  return (
    <span className="copy-path">
      <code>{path}</code>
      <button type="button" onClick={copy} aria-label={`Copy path ${path}`}>
        {state === "copied" ? "Copied" : state === "failed" ? "Copy failed" : "Copy"}
      </button>
    </span>
  );
}
