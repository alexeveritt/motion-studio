# CookGuide QR Code Advert

## Objective

Get home cooks to scan the QR code and start cooking with CookGuide.

## Audience

Home cooks scrolling vertical video, especially people deciding what to cook tonight.

## Single key message

CookGuide guides you through every recipe, step by step.

## Call to action

Scan the QR code to start cooking.

## Format and duration

1080 × 1920, 30 fps, 360 frames (12s). Poster frame 300.

## Narrative and scenes

|  Frames |       Time | Scene          | Content                                                                                          |
| ------: | ---------: | -------------- | ------------------------------------------------------------------------------------------------ |
|    0–59 |  0.0–2.0 s | Hook           | "Not sure what to cook tonight?" with the CookGuide logo visible from the first frame.           |
|  60–179 |  2.0–6.0 s | Value          | The CookGuide app screen rises into view; benefit line "Step-by-step guidance for every recipe". |
| 180–269 |  6.0–9.0 s | Transition     | The phone settles and gives way to a white action card that will hold the QR code.               |
| 270–359 | 9.0–12.0 s | Call to action | Large static QR code, "Scan to start cooking", short instruction, CookGuide logo above.          |

## Required content

- CookGuide name and logo.
- One app interface visual.
- QR code generated from `qrUrl` in `props.json`, never hard-coded.

## Prohibited content

- Any claim listed under "Claims that must not be made" in the project context.
- Logos, text or motion over or touching the QR code.
- Flashing, strobing or rapid cuts.

## Visual direction

Cream background, herb-green and tomato accents, Inter type. Calm, confident motion with gentle easing. Generous whitespace.

## Audio direction

None in version one. The advert must work silently.

## Accessibility

- The opening question is readable within two seconds.
- All text stays inside the portrait safe area and is at least 40 px at 1080 × 1920.
- High contrast: ink on cream, black on white for the QR code.
- No flashing; nothing moves faster than a gentle slide.

## Deliverables

- Standard-profile H.264 MP4 (1080 × 1920, 30 fps, 360 frames) and a PNG poster of frame 300.
- Render manifest committed with the outputs.

## Acceptance criteria

- The QR code is fully static for frames 270–359, has a four-module quiet zone and decodes to `qrUrl` exactly from the poster and from a paused frame.
- The logo never overlaps the QR code.
- Text stays inside the safe area.
- The final frames work as the poster.
