import type { FieldIssue } from "@motion-studio/core/schemas";

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly issues: FieldIssue[];

  constructor(status: number, code: string, message: string, issues: FieldIssue[] = []) {
    super(message);
    this.status = status;
    this.code = code;
    this.issues = issues;
  }
}

/** Call a local API endpoint. Same-origin only; the browser adds the Origin header the server checks. */
export async function api<T>(
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE",
  url: string,
  body?: unknown,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      method,
      credentials: "same-origin",
      ...(body === undefined
        ? {}
        : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
    });
  } catch {
    throw new ApiError(0, "NETWORK", "Could not reach the studio server. Is it still running?");
  }
  const data = (await response.json().catch(() => ({}))) as {
    error?: { code: string; message: string; issues?: FieldIssue[] };
  };
  if (!response.ok) {
    const error = data.error ?? { code: "HTTP_" + response.status, message: response.statusText };
    throw new ApiError(response.status, error.code, error.message, error.issues);
  }
  return data as T;
}

/** Group issues by field path. Issues without a path go under "". */
export function issuesByField(issues: FieldIssue[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const issue of issues) result[issue.path] ??= issue.message;
  return result;
}
