# CookGuide QR Code Advert notes

## Status

Built as Motion Studio's version-one acceptance production. The composition is complete; the content is not yet approved for publishing.

## Before publishing

- [ ] Replace `props.json` `qrUrl` (currently the non-resolving placeholder `https://cookguide.example/start`) with the owner-approved HTTPS URL, then re-render and re-run `pnpm acceptance`.
- [ ] Replace `brand:placeholder-logo-mark.svg` and `production:placeholder-phone-recipe.svg` with approved artwork (update the references in `src/scenes/Logo.tsx` and `src/scenes/Phone.tsx` if the stored names change).
- [ ] Confirm the copy and the "To confirm" items in the project context.
- [ ] Update the golden baselines (`pnpm golden -- 01a13f5a-7f92-736b-b504-211bc5da4a87 --update`) after the changes above and review them before committing.

## Acceptance

`pnpm acceptance` automates spec section 17.4 steps 3 and 6–15 and the section 17.5 failure tests. Steps 4–5 (scrub and step in the Preview tab) are covered by the browser tests and were checked by hand on 2026-10-15.

On 2026-10-15 all 16 automated checks passed. Two standard renders with fingerprint `55c01272…` produced byte-identical MP4s, and the QR code decoded to the configured URL from both the poster (frame 300) and paused frame 330.
