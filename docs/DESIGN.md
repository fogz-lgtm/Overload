# Overload design system

Overload should feel like a paid, premium training app: confident, calm, fast, and data-rich without clutter. Think Whoop / Apple Fitness polish with a lifting focus.

## Principles

1. **One accent.** Volt (`--accent-fill`) is for the single most important action or the thing that changed (a completed set, a PR, the active tab). Everything else is neutral. Never use the accent for decoration.
2. **Numbers are heroes.** Weights, reps, scores, durations and counts use the condensed display face (`.display` or `.stat .value`, Barlow Condensed 700) at large sizes. Labels around them are small, quiet, and set in Inter.
3. **Hierarchy by size and ink, not boxes.** Prefer one card with clear internal hierarchy over many small cards. Use `--text-1/2/3` deliberately: title → supporting → meta.
4. **Explain, don't decorate.** Every screen answers "what should I do / how am I doing" first. Secondary detail goes behind a tap (sheet, expand, detail page).
5. **Motion with purpose.** Things enter (`page-in`, `sheet-up`, `toast-in`), completions celebrate (spring pop), numbers count up. Nothing loops except progress and pulse indicators. Everything respects `prefers-reduced-motion` (handled globally).
6. **Thumb-first.** Primary actions sit low on the screen, touch targets are ≥ 44px, and destructive actions are never the easiest tap.

## Tokens (see `src/styles.css`)

| Purpose | Token |
|---|---|
| Canvas / raised canvas (sheets) | `--bg`, `--bg-raised` |
| Surfaces: card → input/chip → track/pressed | `--surface-1`, `--surface-2`, `--surface-3` |
| Hairlines | `--line`, `--line-strong` |
| Ink | `--text-1` (primary), `--text-2` (supporting), `--text-3` (meta/labels) |
| Brand | `--accent` (text/strokes), `--accent-fill` + `--accent-fill-2` (gradient fills), `--accent-ink` (text on fill), `--accent-soft` (tints), `--accent-line` (accent borders), `--accent-glow` |
| Semantic (always with icon or word) | `--danger`, `--warning`, `--good`, `--pr` (gold for records) |
| Viz | `--chart` (= accent), `--grid`, `--fatigue`, `--muscle-base`, `--muscle-fresh`, `--muscle-hit` (trained-muscle highlight; deeper in light mode), session tags `--tag-push/pull/legs/full` |
| Radius | `--r-xs 8`, `--r-sm 12`, `--r-md 16`, `--r-lg 22`, `--r-xl 28` |
| Motion | `--ease`, `--spring`, `--d1 140ms`, `--d2 240ms`, `--d3 420ms` |
| Fonts | `--font` (Inter), `--display` (Barlow Condensed) |

Light mode is defined for every token. Never hard-code hex colours in components, except the plate colours in `PlateStack`.

## Type scale

| Use | Style |
|---|---|
| Screen title | `h1` — 30px Inter 800, −0.035em |
| Section/card heading | `h2` 21px / `h3` 16px |
| Eyebrow above titles, section labels | `.eyebrow` / `.section-title` — 11px, uppercase, 0.12em tracking, `--text-3` |
| Hero number | `.display` at 44–72px (inline `fontSize`), optional `.italic` for celebratory moments |
| Stat number | `.stat .value` (30px display) + `.stat .label` |
| Body | 15px; supporting 13px (`.small`) |

## Components & patterns

**Layout.** Every screen is `<div className="page">`, which gives safe-area padding, a 16px gutter, a 16px vertical rhythm and the page-in animation. The header is `.page-header` with an `h1`, an optional `.sub` line, and at most one trailing `.icon-btn`. Detail pages start with a back `.icon-btn` (`Icon name="back"`).

**Surfaces.**
- `.card` is the default container (22px radius, hairline border, inner highlight).
- `.card.hero` is the accent-tinted card. Use it **once per screen at most**, for the primary object.
- `.group` + `.group-row` give iOS-style grouped lists (settings, menus). Use a `.row-icon` tile for the leading icon and `.value` for the trailing value, with `Icon name="chevron"` for navigation rows.
- `.list` + `.list-item` give separated rows inside a card.

**Buttons.**
- `.btn.primary` is the gradient volt pill with a glow. Use one per view.
- `.btn` is the neutral secondary, `.btn.ghost` is tertiary, and `.btn.danger` is destructive text.
- Sizes: `.sm` and `.lg`; add `.block` for full width.
- `.icon-btn` is a 42px circle (`.sm` is 34px).

**Selection.**
- `.chip` pills invert to solid ink when `aria-pressed="true"`. Put them in `.chips` (horizontal scroll) or `.chips.wrap`.
- `.segmented` is for 2–4 mutually exclusive options.
- `.toggle` with a checkbox gives an iOS switch.
- `Range` (`src/ui/Range.tsx`) is a labelled slider with a filled track.

**Data display.**
- `.stats` / `.stats.four` grid of `.stat`.
- `.bar > .fill` progress bars.
- `Ring` (`src/ui/Ring.tsx`) for a single 0–1 metric.
- `Sparkline` for trend beside a number.
- `LineChart` (area chart, crosshair tooltip) for one series over time — the card title names the series.
- `CountUp` animates a number on first render.

**Anatomy.**
- `MuscleThumb` (in `src/components/BodyMap.tsx`) is a 40–64px tile with an exercise's or workout's primary muscles in volt and secondaries in a soft tint. Use it as the leading visual for exercise rows.
- `Figure` draws a full front or back view with any fill function.
- `BodyMap` is the recovery map, on a single-hue fatigue ramp.

**Feedback.**
- `toast(text, { icon, tone: 'accent' })` from `src/ui/toast.tsx` confirms an action (saved, imported, deleted).
- `EmptyState` (icon in a glowing circle, title, body, optional action) appears whenever a list or chart has no data.
- `Sheet` (title, subtitle, drag-to-dismiss) holds secondary flows. Its body uses `.stack.lg`.
- `haptics.tap()` / `.success()` give tactile confirmation on Android.

**Icons.** `Icon` (`src/components/Icon.tsx`) is a 24px stroke icon set. Add new paths there rather than inlining SVG in pages.

## Writing

- Sentence case everywhere, except eyebrows (uppercase via CSS).
- Numbers before nouns ("6 exercises · 52 min").
- Use the user's units through `formatWeight`.
- Labels are 1–3 words. Explanations are one sentence, written plainly and in second person.
- No exclamation marks except for genuine celebrations (PRs).

## Page-specific CSS

Put screen-specific styles in `src/pages/<Screen>.css`, imported by that page, using a screen-prefixed class (`.progress-…`, `.hist-…`). Keep them on tokens. `styles.css` holds only shared primitives.
