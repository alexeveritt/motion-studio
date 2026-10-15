/**
 * Stable machine-readable error codes. The UI and API surface `code`; `message`
 * is user-facing and must never contain absolute paths or stack traces.
 */
export type ErrorCode =
  | "SCHEMA_INVALID"
  | "SCHEMA_VERSION_UNSUPPORTED"
  | "JSON_INVALID"
  | "SETTINGS_NOT_FOUND"
  | "PATH_OUTSIDE_ROOT"
  | "REFERENCE_MISMATCH"
  | "DUPLICATE_ID"
  | "SLUG_MISMATCH"
  | "UNKNOWN_RENDER_PROFILE"
  | "RECORD_MISSING"
  | "UNSAFE_ENTRY"
  | "READ_FAILED"
  | "UNSAFE_PATH"
  | "NOT_FOUND"
  | "REVISION_CONFLICT"
  | "INVALID_INPUT"
  | "LIMIT_EXCEEDED"
  | "ALREADY_EXISTS"
  | "CONFIRMATION_REQUIRED"
  | "IN_USE"
  | "UNSUPPORTED_MEDIA";

export class MotionStudioError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "MotionStudioError";
    this.code = code;
  }
}
