import {
  productionCreateInputSchema,
  productionUpdateInputSchema,
  type ProductionRecord,
} from "@motion-studio/core/schemas";
import { slugify } from "@motion-studio/core/slug";
import { formatDurationLabel } from "@motion-studio/core/time";
import { useState, type SubmitEvent } from "react";
import { api } from "../lib/client/api.ts";
import {
  FormStatus,
  SelectField,
  TextAreaField,
  TextField,
  textToTags,
  toInt,
} from "./forms/fields.tsx";
import { useSubmit } from "./forms/useSubmit.ts";

type Option = { value: string; label: string };

type Props =
  | {
      mode: "create";
      campaignId: string;
      basePath: string;
      profiles: Option[];
      defaultProfileId: string;
    }
  | { mode: "edit"; record: ProductionRecord; profiles: Option[] };

const STATUSES: Option[] = [
  { value: "idea", label: "Idea" },
  { value: "briefing", label: "Briefing" },
  { value: "in-development", label: "In development" },
  { value: "review", label: "Review" },
  { value: "approved", label: "Approved" },
  { value: "archived", label: "Archived" },
];

const PRESETS = [
  { label: "Portrait 9:16", width: 1080, height: 1920 },
  { label: "Square 1:1", width: 1080, height: 1080 },
  { label: "Feed 4:5", width: 1080, height: 1350 },
  { label: "Landscape 16:9", width: 1920, height: 1080 },
];

export default function ProductionForm(props: Props) {
  const record = props.mode === "edit" ? props.record : undefined;
  const [title, setTitle] = useState(record?.title ?? "");
  const [slug, setSlug] = useState("");
  const [description, setDescription] = useState(record?.description ?? "");
  const [status, setStatus] = useState<string>(record?.status ?? "idea");
  const [width, setWidth] = useState(String(record?.format.width ?? 1080));
  const [height, setHeight] = useState(String(record?.format.height ?? 1920));
  const [fps, setFps] = useState(String(record?.format.fps ?? 30));
  const [frames, setFrames] = useState(String(record?.format.durationInFrames ?? 360));
  const [posterFrame, setPosterFrame] = useState(record ? String(record.posterFrame) : "");
  const [profileId, setProfileId] = useState(
    record?.defaultRenderProfileId ?? (props.mode === "create" ? props.defaultProfileId : ""),
  );
  const [tags, setTags] = useState(record?.tags.join(", ") ?? "");

  const format = {
    width: toInt(width),
    height: toInt(height),
    fps: toInt(fps),
    durationInFrames: toInt(frames),
  };
  const validTiming =
    Number.isInteger(format.fps) &&
    format.fps > 0 &&
    Number.isInteger(format.durationInFrames) &&
    format.durationInFrames > 0;
  const lastFrame = validTiming ? format.durationInFrames - 1 : undefined;

  const create = useSubmit(productionCreateInputSchema, async (input) => {
    if (props.mode !== "create") return undefined;
    const created = await api<ProductionRecord>(
      "POST",
      `/api/campaigns/${props.campaignId}/productions`,
      input,
    );
    window.location.assign(`${props.basePath}/${created.slug}`);
    return created;
  });
  const update = useSubmit(productionUpdateInputSchema, async (input) => {
    const updated = await api<ProductionRecord>("PATCH", `/api/productions/${record!.id}`, input);
    window.location.reload();
    return updated;
  });
  const { errors, formError, busy } = record ? update : create;

  function onSubmit(event: SubmitEvent) {
    event.preventDefault();
    const fields = {
      title,
      description,
      format,
      defaultRenderProfileId: profileId,
      tags: textToTags(tags),
    };
    if (record) {
      void update.run({
        ...fields,
        revision: record.revision,
        status,
        posterFrame: toInt(posterFrame),
      });
    } else {
      void create.run({
        ...fields,
        slug: slug.trim() || undefined,
        ...(posterFrame.trim() ? { posterFrame: toInt(posterFrame) } : {}),
      });
    }
  }

  return (
    <form className="record-form" onSubmit={onSubmit} noValidate>
      <TextField
        label="Title"
        name="title"
        required
        value={title}
        onChange={setTitle}
        error={errors.title}
      />
      {record ? (
        <TextField
          label="Folder and composition ID"
          value={`${record.slug} · ${record.compositionId}`}
          onChange={() => {}}
          readOnly
          hint="Fixed after creation."
        />
      ) : (
        <TextField
          label="Folder name"
          name="slug"
          value={slug}
          onChange={setSlug}
          error={errors.slug}
          placeholder={slugify(title) || "derived from the title"}
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

      <fieldset>
        <legend>Format</legend>
        <div className="presets" role="group" aria-label="Size presets">
          {PRESETS.map((preset) => (
            <button
              key={preset.label}
              type="button"
              aria-pressed={format.width === preset.width && format.height === preset.height}
              onClick={() => {
                setWidth(String(preset.width));
                setHeight(String(preset.height));
              }}
            >
              {preset.label}
            </button>
          ))}
        </div>
        <div className="field-row">
          <TextField
            label="Width"
            name="width"
            type="number"
            min={16}
            required
            value={width}
            onChange={setWidth}
            error={errors["format.width"] ?? errors.format}
          />
          <TextField
            label="Height"
            name="height"
            type="number"
            min={16}
            required
            value={height}
            onChange={setHeight}
            error={errors["format.height"]}
          />
          <TextField
            label="FPS"
            name="fps"
            type="number"
            min={1}
            required
            value={fps}
            onChange={setFps}
            error={errors["format.fps"]}
          />
          <TextField
            label="Duration (frames)"
            name="durationInFrames"
            type="number"
            min={1}
            required
            value={frames}
            onChange={setFrames}
            error={errors["format.durationInFrames"]}
            hint={
              validTiming ? formatDurationLabel(format.durationInFrames, format.fps) : undefined
            }
          />
        </div>
        <TextField
          label="Poster frame"
          name="posterFrame"
          type="number"
          min={0}
          required={Boolean(record)}
          value={posterFrame}
          onChange={setPosterFrame}
          error={errors.posterFrame}
          placeholder={record || lastFrame === undefined ? undefined : `${lastFrame} (last frame)`}
          hint={
            lastFrame === undefined
              ? undefined
              : `0 to ${lastFrame}. Frame ${format.durationInFrames} does not exist.`
          }
        />
      </fieldset>

      <SelectField
        label="Default render profile"
        name="defaultRenderProfileId"
        value={profileId}
        onChange={setProfileId}
        options={props.profiles}
        error={errors.defaultRenderProfileId}
      />
      <TextField
        label="Tags"
        name="tags"
        value={tags}
        onChange={setTags}
        hint="Comma separated, lowercase with hyphens."
        error={errors.tags ?? Object.entries(errors).find(([key]) => key.startsWith("tags."))?.[1]}
      />
      <FormStatus error={formError} />
      <div className="form-actions">
        <button type="submit" className="primary" disabled={busy}>
          {busy ? "Saving…" : record ? "Save production" : "Create production"}
        </button>
      </div>
    </form>
  );
}
