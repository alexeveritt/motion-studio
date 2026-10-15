import { formatIssues, type FieldIssue } from "@motion-studio/core/schemas";
import { useState } from "react";
import type { z } from "zod";
import { ApiError, issuesByField } from "../../lib/client/api.ts";

/**
 * Validate with the shared schema in the browser, then submit. Server-side
 * field issues are mapped back onto the same fields.
 */
export function useSubmit<T extends z.ZodType, R>(
  schema: T,
  submit: (input: z.infer<T>) => Promise<R>,
) {
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function run(input: unknown): Promise<R | undefined> {
    setFormError(undefined);
    const parsed = schema.safeParse(input);
    if (!parsed.success) {
      showIssues(formatIssues(parsed.error));
      return undefined;
    }
    setErrors({});
    setBusy(true);
    try {
      return await submit(parsed.data);
    } catch (error) {
      if (error instanceof ApiError) {
        if (error.issues.length > 0) showIssues(error.issues);
        else setFormError(error.message);
      } else {
        setFormError("Something went wrong. See the browser console.");
        console.error(error);
      }
      return undefined;
    } finally {
      setBusy(false);
    }
  }

  function showIssues(issues: FieldIssue[]) {
    const byField = issuesByField(
      issues.map((issue) => ({ ...issue, message: friendly(issue.message) })),
    );
    setErrors(byField);
    setFormError(byField[""] ?? "Check the highlighted fields.");
  }

  return { errors, formError, busy, run };
}

function friendly(message: string): string {
  if (/expected (int|number), received NaN/i.test(message)) return "Enter a whole number";
  if (/expected int, received number/i.test(message)) return "Enter a whole number";
  return message;
}
