import {
  projectCreateInputSchema,
  projectUpdateInputSchema,
  type ProjectRecord,
} from "@motion-studio/core/schemas";
import { slugify } from "@motion-studio/core/slug";
import { useState, type SubmitEvent } from "react";
import { api } from "../lib/client/api.ts";
import { FormStatus, SelectField, TextAreaField, TextField } from "./forms/fields.tsx";
import { useSubmit } from "./forms/useSubmit.ts";

type Option = { value: string; label: string };

type Props =
  | { mode: "create"; profiles: Option[]; defaultProfileId: string }
  | { mode: "edit"; profiles: Option[]; record: ProjectRecord };

const STATUSES: Option[] = [
  { value: "active", label: "Active" },
  { value: "archived", label: "Archived" },
];

export default function ProjectForm(props: Props) {
  const record = props.mode === "edit" ? props.record : undefined;
  const [name, setName] = useState(record?.name ?? "");
  const [slug, setSlug] = useState("");
  const [description, setDescription] = useState(record?.description ?? "");
  const [status, setStatus] = useState<string>(record?.status ?? "active");
  const [profileId, setProfileId] = useState(
    record?.defaultRenderProfileId ?? (props.mode === "create" ? props.defaultProfileId : ""),
  );
  const [repoPath, setRepoPath] = useState(record?.sourceRepository?.path ?? "");
  const [repoLabel, setRepoLabel] = useState(record?.sourceRepository?.label ?? "");

  const sourceRepository = repoPath.trim()
    ? { path: repoPath.trim(), ...(repoLabel.trim() ? { label: repoLabel.trim() } : {}) }
    : null;

  const create = useSubmit(projectCreateInputSchema, async (input) => {
    const created = await api<ProjectRecord>("POST", "/api/projects", input);
    window.location.assign(`/projects/${created.slug}`);
    return created;
  });
  const update = useSubmit(projectUpdateInputSchema, async (input) => {
    const updated = await api<ProjectRecord>("PATCH", `/api/projects/${record!.id}`, input);
    window.location.reload();
    return updated;
  });
  const { errors, formError, busy } = record ? update : create;

  function onSubmit(event: SubmitEvent) {
    event.preventDefault();
    if (record) {
      void update.run({
        revision: record.revision,
        name,
        description,
        status,
        defaultRenderProfileId: profileId,
        sourceRepository,
      });
    } else {
      void create.run({
        name,
        description,
        slug: slug.trim() || undefined,
        defaultRenderProfileId: profileId,
        ...(sourceRepository ? { sourceRepository } : {}),
      });
    }
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
          hint="Optional. Lowercase letters, digits and hyphens. Cannot be changed later."
        />
      )}
      <TextAreaField
        label="Description"
        name="description"
        value={description}
        onChange={setDescription}
        error={errors.description}
      />
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
      <SelectField
        label="Default render profile"
        name="defaultRenderProfileId"
        value={profileId}
        onChange={setProfileId}
        options={props.profiles}
        error={errors.defaultRenderProfileId}
      />
      <fieldset>
        <legend>Source repository (informational only)</legend>
        <TextField
          label="Path"
          name="sourceRepositoryPath"
          value={repoPath}
          onChange={setRepoPath}
          error={errors["sourceRepository.path"]}
          hint="Shown as text. Motion Studio never reads from or runs commands in it."
        />
        <TextField
          label="Label"
          name="sourceRepositoryLabel"
          value={repoLabel}
          onChange={setRepoLabel}
          error={errors["sourceRepository.label"]}
        />
      </fieldset>
      <FormStatus error={formError} />
      <div className="form-actions">
        <button type="submit" className="primary" disabled={busy}>
          {busy ? "Saving…" : record ? "Save project" : "Create project"}
        </button>
      </div>
    </form>
  );
}
