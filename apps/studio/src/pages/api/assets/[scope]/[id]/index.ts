import { assetTarget, streamChunks } from "../../../../../lib/server/assets.ts";
import { handler, HttpError } from "../../../../../lib/server/http.ts";
import { getAssets, getWorkspace } from "../../../../../lib/server/studio.ts";

export const GET = handler(async (context) => (await getAssets()).list(...assetTarget(context)));

/**
 * Upload one file. Body: the raw bytes as `application/octet-stream`; the
 * original name travels URI-encoded in `X-File-Name`. The type is detected
 * from the bytes, never from these headers.
 */
export const POST = handler(async (context) => {
  const { request } = context;
  const target = assetTarget(context);
  if (!/^application\/octet-stream\s*(;|$)/i.test(request.headers.get("content-type") ?? "")) {
    throw new HttpError(415, "INVALID_INPUT", "Upload the file as application/octet-stream");
  }
  const limit = (await getWorkspace()).settings.limits.maxUploadBytes;
  if (Number(request.headers.get("content-length") ?? "0") > limit) {
    throw new HttpError(413, "LIMIT_EXCEEDED", "The file is larger than the upload limit");
  }
  let originalName: string;
  try {
    originalName = decodeURIComponent(request.headers.get("x-file-name") ?? "");
  } catch {
    throw new HttpError(400, "INVALID_INPUT", "X-File-Name is not valid URI encoding");
  }
  if (!request.body) throw new HttpError(400, "INVALID_INPUT", "The file is empty");
  return (await getAssets()).upload(...target, { originalName, body: streamChunks(request.body) });
}, 201);
