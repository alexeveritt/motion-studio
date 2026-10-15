import { validateProps, type PropsField, type PropsSchema } from "@motion-studio/core/props-schema";
import { useId, useMemo, useState, type SubmitEvent } from "react";
import { api, ApiError, issuesByField } from "../lib/client/api.ts";

type Document = { content: string; hash: string; exists: boolean; path: string };

type Props = {
  productionId: string;
  schema: PropsSchema;
  schemaPath: string;
  initial: Document;
};

/** Form values are kept as strings (or "" for "not set") until saved. */
type Values = Record<string, string>;

const UNSET = "";

/**
 * A form generated from the production's props.schema.json. Validates with
 * the same rules as preflight, writes props.json through the document API
 * with conflict protection, and leaves out fields that are not set so the
 * schema and composition defaults apply.
 */
export default function PropsForm({ productionId, schema, schemaPath, initial }: Props) {
  const parsed = useMemo(() => parseProps(initial.content), [initial.content]);
  const [values, setValues] = useState<Values>(() => toValues(schema, parsed.props));
  const [saved, setSaved] = useState(initial);
  const [savedValues, setSavedValues] = useState(values);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string }>();
  const [conflict, setConflict] = useState(false);
  const [busy, setBusy] = useState(false);

  const fields = Object.entries(schema.properties);
  const unknownKeys = Object.keys(parsed.props).filter(
    (key) => !Object.hasOwn(schema.properties, key),
  );
  const dirty = JSON.stringify(values) !== JSON.stringify(savedValues) || unknownKeys.length > 0;

  async function onSubmit(event: SubmitEvent) {
    event.preventDefault();
    setMessage(undefined);
    const output = fromValues(schema, values);
    const issues = validateProps(schema, output);
    setErrors(issuesByField(issues));
    if (issues.length > 0) {
      setMessage({ tone: "error", text: "Check the highlighted fields." });
      return;
    }
    setBusy(true);
    try {
      const content = `${JSON.stringify(output, null, 2)}\n`;
      const result = await api<Document>("PUT", `/api/documents/production/${productionId}/props`, {
        content,
        baseHash: saved.hash,
      });
      setSaved(result);
      setSavedValues(values);
      setMessage({ tone: "ok", text: "Saved props.json" });
    } catch (error) {
      if (error instanceof ApiError && error.issues.length > 0)
        setErrors(issuesByField(error.issues));
      if (error instanceof ApiError && error.code === "REVISION_CONFLICT") setConflict(true);
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "Save failed" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel" aria-labelledby="props-heading">
      <div className="section-header">
        <div>
          <h2 id="props-heading">{schema.title ?? "Props"}</h2>
          {schema.description && <p className="muted">{schema.description}</p>}
          <p className="muted">
            Saved to <code>{saved.path}</code>. Fields you leave empty use the default. The form
            follows <code>{schemaPath}</code>.
          </p>
        </div>
      </div>

      {parsed.error && (
        <div className="form-status" data-tone="error" role="alert">
          props.json could not be read ({parsed.error}). Saving this form replaces it.
        </div>
      )}
      {unknownKeys.length > 0 && (
        <div className="form-status" data-tone="error" role="alert">
          props.json has values the schema does not define, which preflight rejects:{" "}
          {unknownKeys.join(", ")}. Saving this form removes them.
        </div>
      )}

      <form
        className="record-form"
        onSubmit={(event) => void onSubmit(event)}
        noValidate
        aria-label="Props"
      >
        {fields.length === 0 && <p className="muted">The schema defines no props.</p>}
        {fields.map(([name, field]) => (
          <PropField
            key={name}
            name={name}
            field={field}
            required={schema.required.includes(name)}
            value={values[name] ?? UNSET}
            error={errors[name]}
            onChange={(value) => setValues((current) => ({ ...current, [name]: value }))}
          />
        ))}
        {message && (
          <div
            className="form-status"
            data-tone={message.tone}
            role={message.tone === "error" ? "alert" : "status"}
          >
            {message.text}
            {conflict && (
              <div className="conflict-actions">
                <button type="button" onClick={() => window.location.reload()}>
                  Reload latest from disk
                </button>
              </div>
            )}
          </div>
        )}
        <div className="form-actions">
          <button type="submit" className="primary" disabled={busy || !dirty}>
            {busy ? "Saving…" : "Save props"}
          </button>
          {dirty && <span className="muted">Unsaved changes</span>}
        </div>
      </form>
    </section>
  );
}

function PropField({
  name,
  field,
  required,
  value,
  error,
  onChange,
}: {
  name: string;
  field: PropsField;
  required: boolean;
  value: string;
  error: string | undefined;
  onChange: (value: string) => void;
}) {
  const id = useId();
  const describedBy = error ? `${id}-error` : `${id}-hint`;
  const common = {
    id,
    name,
    "aria-invalid": error ? true : undefined,
    "aria-describedby": describedBy,
  } as const;
  const defaultText = field.default === undefined ? undefined : `Default: ${String(field.default)}`;

  let control;
  if (field.type === "boolean") {
    control = (
      <select {...common} value={value} onChange={(event) => onChange(event.target.value)}>
        <option value={UNSET}>
          {field.default === undefined
            ? "Not set"
            : `Use default (${field.default ? "yes" : "no"})`}
        </option>
        <option value="true">Yes</option>
        <option value="false">No</option>
      </select>
    );
  } else if (field.enum) {
    control = (
      <select {...common} value={value} onChange={(event) => onChange(event.target.value)}>
        <option value={UNSET}>
          {field.default === undefined ? "Not set" : `Use default (${field.default})`}
        </option>
        {field.enum.map((option) => (
          <option key={String(option)} value={String(option)}>
            {String(option)}
          </option>
        ))}
      </select>
    );
  } else if (field.type === "number" || field.type === "integer") {
    control = (
      <input
        {...common}
        type="number"
        inputMode={field.type === "integer" ? "numeric" : "decimal"}
        step={field.type === "integer" ? 1 : "any"}
        min={field.minimum}
        max={field.maximum}
        placeholder={defaultText}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    );
  } else if (field.type === "string") {
    control = (
      <StringInput
        field={field}
        value={value}
        onChange={onChange}
        common={common}
        defaultText={defaultText}
      />
    );
  }

  return (
    <div className="field" data-invalid={error ? "" : undefined}>
      <div className="field-label">
        <label htmlFor={id}>{field.title ?? name}</label>
        {required && (
          <span className="field-required" aria-hidden="true">
            *
          </span>
        )}
        <code className="prop-name">{name}</code>
      </div>
      {control}
      {error ? (
        <div className="field-error" id={`${id}-error`} role="alert">
          {error}
        </div>
      ) : (
        <div className="field-hint" id={`${id}-hint`}>
          {[field.description, field.type !== "boolean" && !field.enum ? defaultText : undefined]
            .filter(Boolean)
            .join(" · ")}
        </div>
      )}
    </div>
  );
}

type StringField = Extract<PropsField, { type: "string" }>;

function StringInput({
  field,
  value,
  onChange,
  common,
  defaultText,
}: {
  field: StringField;
  value: string;
  onChange: (value: string) => void;
  common: Record<string, unknown>;
  defaultText: string | undefined;
}) {
  // Long free text gets a textarea; URLs, dates and colours are always single-line.
  if (field.format === undefined && field.maxLength !== undefined && field.maxLength > 160) {
    return (
      <textarea
        {...common}
        rows={3}
        placeholder={defaultText}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    );
  }
  const type = field.format === "uri" ? "url" : field.format === "date" ? "date" : "text";
  const swatch = /^#[0-9a-f]{3,6}$/i.test(value) ? value : (field.default ?? "transparent");
  return (
    <div className="prop-input">
      {field.format === "color" && (
        <span className="colour-swatch" aria-hidden="true" style={{ background: swatch }} />
      )}
      <input
        {...common}
        type={type}
        maxLength={field.maxLength}
        placeholder={
          defaultText ??
          (field.format === "uri" ? "https://" : field.format === "color" ? "#2E7D4F" : undefined)
        }
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}

function parseProps(content: string): { props: Record<string, unknown>; error?: string } {
  if (content.trim() === "") return { props: {} };
  try {
    const value: unknown = JSON.parse(content);
    if (value && typeof value === "object" && !Array.isArray(value))
      return { props: value as Record<string, unknown> };
    return { props: {}, error: "not a JSON object" };
  } catch {
    return { props: {}, error: "not valid JSON" };
  }
}

function toValues(schema: PropsSchema, props: Record<string, unknown>): Values {
  return Object.fromEntries(
    Object.keys(schema.properties).map((name) => [
      name,
      props[name] === undefined ? UNSET : String(props[name]),
    ]),
  );
}

/** Convert form strings back to typed props, leaving unset fields out. Invalid numbers stay NaN so validation reports them. */
function fromValues(schema: PropsSchema, values: Values): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const [name, field] of Object.entries(schema.properties)) {
    const raw = values[name] ?? UNSET;
    if (raw === UNSET) continue;
    if (field.type === "boolean") output[name] = raw === "true";
    else if (field.type === "number" || field.type === "integer") output[name] = Number(raw);
    else output[name] = raw;
  }
  return output;
}
