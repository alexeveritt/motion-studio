import {
  MotionStudioError,
  PreflightFailedError,
  SchemaValidationError,
  type ErrorCode,
} from "@motion-studio/core";
import type { APIContext, APIRoute } from "astro";

const MAX_JSON_BYTES = 1024 * 1024;

const STATUS: Partial<Record<ErrorCode, number>> = {
  INVALID_INPUT: 400,
  UNSAFE_PATH: 400,
  CONFIRMATION_REQUIRED: 400,
  NOT_FOUND: 404,
  REVISION_CONFLICT: 409,
  ALREADY_EXISTS: 409,
  IN_USE: 409,
  BUSY: 409,
  INPUTS_CHANGED: 409,
  PREFLIGHT_FAILED: 422,
  LIMIT_EXCEEDED: 413,
  UNSUPPORTED_MEDIA: 415,
};

export class HttpError extends MotionStudioError {
  readonly status: number;

  constructor(status: number, code: ErrorCode, message: string) {
    super(code, message);
    this.status = status;
  }
}

/** JSON error body with a stable code. Never includes stack traces or absolute paths. */
export function errorResponse(error: unknown): Response {
  if (error instanceof MotionStudioError) {
    const status = error instanceof HttpError ? error.status : (STATUS[error.code] ?? 500);
    const issues = error instanceof SchemaValidationError ? error.issues : undefined;
    // A failed preflight returns the full check list so the UI can show it.
    const preflight = error instanceof PreflightFailedError ? error.result : undefined;
    if (status >= 500) console.error(error);
    return Response.json(
      { error: { code: error.code, message: error.message, issues }, preflight },
      { status },
    );
  }
  console.error(error);
  return Response.json(
    { error: { code: "INTERNAL", message: "Unexpected server error. See the studio terminal." } },
    { status: 500 },
  );
}

/**
 * Read a JSON request body. Requires `application/json` and enforces a size
 * limit on both the declared and the actual length.
 */
export async function readJsonBody(request: Request, maxBytes = MAX_JSON_BYTES): Promise<unknown> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!/^application\/json\s*(;|$)/i.test(contentType)) {
    throw new HttpError(415, "INVALID_INPUT", "Expected a JSON request body");
  }
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > maxBytes) throw new HttpError(413, "LIMIT_EXCEEDED", "Request body is too large");
  const buffer = await request.arrayBuffer();
  if (buffer.byteLength > maxBytes)
    throw new HttpError(413, "LIMIT_EXCEEDED", "Request body is too large");
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(buffer));
  } catch {
    throw new HttpError(400, "INVALID_INPUT", "Request body is not valid JSON");
  }
}

export function param(context: APIContext, name: string): string {
  const value = context.params[name];
  if (!value) throw new HttpError(404, "NOT_FOUND", "Not found");
  return value;
}

/** Wrap an endpoint so every thrown error becomes a stable JSON error response. */
export function handler(
  fn: (context: APIContext) => Promise<unknown>,
  successStatus = 200,
): APIRoute {
  return async (context) => {
    try {
      return Response.json(await fn(context), { status: successStatus });
    } catch (error) {
      return errorResponse(error);
    }
  };
}
