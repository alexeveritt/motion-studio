import { useId, type ReactNode } from "react";

type BaseProps = {
  label: string;
  error?: string | undefined;
  hint?: ReactNode;
  required?: boolean;
};

function FieldShell({
  label,
  error,
  hint,
  required,
  id,
  children,
}: BaseProps & { id: string; children: ReactNode }) {
  return (
    <div className="field" data-invalid={error ? "" : undefined}>
      <div className="field-label">
        <label htmlFor={id}>{label}</label>
        {required && (
          <span className="field-required" aria-hidden="true">
            *
          </span>
        )}
      </div>
      {children}
      {hint && !error && (
        <div className="field-hint" id={`${id}-hint`}>
          {hint}
        </div>
      )}
      {error && (
        <div className="field-error" id={`${id}-error`} role="alert">
          {error}
        </div>
      )}
    </div>
  );
}

function describedBy(id: string, error?: string, hint?: ReactNode) {
  return error ? `${id}-error` : hint ? `${id}-hint` : undefined;
}

export function TextField(
  props: BaseProps & {
    value: string;
    onChange: (value: string) => void;
    placeholder?: string | undefined;
    name?: string;
    readOnly?: boolean;
    type?: "text" | "number";
    min?: number;
    max?: number;
  },
) {
  const id = useId();
  return (
    <FieldShell {...props} id={id}>
      <input
        id={id}
        name={props.name}
        type={props.type ?? "text"}
        inputMode={props.type === "number" ? "numeric" : undefined}
        min={props.min}
        max={props.max}
        value={props.value}
        placeholder={props.placeholder}
        readOnly={props.readOnly}
        required={props.required}
        aria-invalid={props.error ? true : undefined}
        aria-describedby={describedBy(id, props.error, props.hint)}
        onChange={(event) => props.onChange(event.target.value)}
      />
    </FieldShell>
  );
}

export function TextAreaField(
  props: BaseProps & {
    value: string;
    onChange: (value: string) => void;
    rows?: number;
    name?: string;
  },
) {
  const id = useId();
  return (
    <FieldShell {...props} id={id}>
      <textarea
        id={id}
        name={props.name}
        rows={props.rows ?? 3}
        value={props.value}
        aria-invalid={props.error ? true : undefined}
        aria-describedby={describedBy(id, props.error, props.hint)}
        onChange={(event) => props.onChange(event.target.value)}
      />
    </FieldShell>
  );
}

export function SelectField(
  props: BaseProps & {
    value: string;
    onChange: (value: string) => void;
    options: readonly { value: string; label: string }[];
    name?: string;
  },
) {
  const id = useId();
  return (
    <FieldShell {...props} id={id}>
      <select
        id={id}
        name={props.name}
        value={props.value}
        aria-invalid={props.error ? true : undefined}
        aria-describedby={describedBy(id, props.error, props.hint)}
        onChange={(event) => props.onChange(event.target.value)}
      >
        {props.options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </FieldShell>
  );
}

/** Summary shown above the submit button. */
export function FormStatus({
  error,
  message,
}: {
  error?: string | undefined;
  message?: string | undefined;
}) {
  if (error) {
    return (
      <div className="form-status" data-tone="error" role="alert">
        {error}
      </div>
    );
  }
  if (message) {
    return (
      <div className="form-status" data-tone="ok" role="status">
        {message}
      </div>
    );
  }
  return null;
}

/** One item per line, blank lines dropped. */
export function linesToList(value: string): string[] {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

/** Comma- or space-separated tags. */
export function textToTags(value: string): string[] {
  return value
    .split(/[\s,]+/)
    .map((tag) => tag.trim())
    .filter(Boolean);
}

export function toInt(value: string): number {
  return value.trim() === "" ? Number.NaN : Number(value);
}
