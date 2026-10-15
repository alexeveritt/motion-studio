import {
  campaignCreateInputSchema,
  campaignUpdateInputSchema,
  type CampaignRecord,
} from "@motion-studio/core/schemas";
import { slugify } from "@motion-studio/core/slug";
import { useState, type SubmitEvent } from "react";
import { api } from "../lib/client/api.ts";
import { FormStatus, linesToList, SelectField, TextAreaField, TextField } from "./forms/fields.tsx";
import { useSubmit } from "./forms/useSubmit.ts";

type Props =
  | { mode: "create"; projectId: string; projectSlug: string }
  | { mode: "edit"; record: CampaignRecord };

const STATUSES = [
  { value: "draft", label: "Draft" },
  { value: "active", label: "Active" },
  { value: "complete", label: "Complete" },
  { value: "archived", label: "Archived" },
];

/** List fields are edited one item per line. */
const listError = (errors: Record<string, string>, key: string) =>
  errors[key] ?? Object.entries(errors).find(([path]) => path.startsWith(`${key}.`))?.[1];

export default function CampaignForm(props: Props) {
  const record = props.mode === "edit" ? props.record : undefined;
  const [name, setName] = useState(record?.name ?? "");
  const [slug, setSlug] = useState("");
  const [description, setDescription] = useState(record?.description ?? "");
  const [objective, setObjective] = useState(record?.objective ?? "");
  const [audience, setAudience] = useState(record?.audience.join("\n") ?? "");
  const [keyMessages, setKeyMessages] = useState(record?.keyMessages.join("\n") ?? "");
  const [channels, setChannels] = useState(record?.channels.join("\n") ?? "");
  const [status, setStatus] = useState<string>(record?.status ?? "draft");

  const create = useSubmit(campaignCreateInputSchema, async (input) => {
    if (props.mode !== "create") return undefined;
    const created = await api<CampaignRecord>(
      "POST",
      `/api/projects/${props.projectId}/campaigns`,
      input,
    );
    window.location.assign(`/projects/${props.projectSlug}/campaigns/${created.slug}`);
    return created;
  });
  const update = useSubmit(campaignUpdateInputSchema, async (input) => {
    const updated = await api<CampaignRecord>("PATCH", `/api/campaigns/${record!.id}`, input);
    window.location.reload();
    return updated;
  });
  const { errors, formError, busy } = record ? update : create;

  function onSubmit(event: SubmitEvent) {
    event.preventDefault();
    const fields = {
      name,
      description,
      objective,
      audience: linesToList(audience),
      keyMessages: linesToList(keyMessages),
      channels: linesToList(channels),
    };
    if (record) void update.run({ ...fields, revision: record.revision, status });
    else void create.run({ ...fields, slug: slug.trim() || undefined });
  }

  return (
    <form className="record-form" onSubmit={onSubmit} noValidate>
      <TextField
        label="Name"
        name="name"
        required
        value={name}
        onChange={setName}
        error={errors.name}
      />
      {record ? (
        <TextField
          label="Folder"
          value={record.slug}
          onChange={() => {}}
          readOnly
          hint="Folder names are fixed after creation."
        />
      ) : (
        <TextField
          label="Folder name"
          name="slug"
          value={slug}
          onChange={setSlug}
          error={errors.slug}
          placeholder={slugify(name) || "derived from the name"}
          hint="Optional. Cannot be changed later."
        />
      )}
      {record && (
        <SelectField
          label="Status"
          name="status"
          value={status}
          onChange={setStatus}
          options={STATUSES}
          error={errors.status}
        />
      )}
      <TextAreaField
        label="Description"
        name="description"
        value={description}
        onChange={setDescription}
        error={errors.description}
      />
      <TextAreaField
        label="Objective"
        name="objective"
        value={objective}
        onChange={setObjective}
        error={errors.objective}
      />
      <TextAreaField
        label="Audience"
        name="audience"
        hint="One per line."
        value={audience}
        onChange={setAudience}
        error={listError(errors, "audience")}
      />
      <TextAreaField
        label="Key messages"
        name="keyMessages"
        hint="One per line."
        value={keyMessages}
        onChange={setKeyMessages}
        error={listError(errors, "keyMessages")}
      />
      <TextAreaField
        label="Channels"
        name="channels"
        hint="One per line."
        value={channels}
        onChange={setChannels}
        error={listError(errors, "channels")}
      />
      <FormStatus error={formError} />
      <div className="form-actions">
        <button type="submit" className="primary" disabled={busy}>
          {busy ? "Saving…" : record ? "Save campaign" : "Create campaign"}
        </button>
      </div>
    </form>
  );
}
