# Implement CookGuide QR Code Advert

Implement the Remotion composition for **CookGuide QR Code Advert** (`cookguide-qr-code-advert`), part of the QR Awareness campaign for CookGuide.

1080 × 1920, 30 fps, 360 frames (12s). Poster frame 300.

## Before you start

- Print the full context packet: `pnpm -s context-packet -- 01a13f5a-7f92-736b-b504-211bc5da4a87` (also available from the Prompt tab in Motion Studio).
- Read `brief.md` in this folder. It is the source of truth for the creative.

## Scope

- Edit only this production folder: `src/` and `tests/`. The entry file is `src/composition.tsx`.
- Use assets by their stored names from this production's `assets/` folder or the campaign, project and brand asset folders.
- Keep the composition deterministic: derive all motion from the current frame and props. No network access, clock reads or unseeded randomness.
- Change format, duration or poster frame through Motion Studio rather than editing `production.json`.
- Do not commit or push.

## Done when

- The acceptance criteria in `brief.md` are met.
- `pnpm check` and `pnpm validate:workspace` pass.
