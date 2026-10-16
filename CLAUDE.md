# CLAUDE.md

Guidance for Claude Code working in this plugin.

## Project Overview

A TRMNL plugin that shows a glanceable HappyFox help-desk dashboard: one user-chosen hero
count plus the remaining data points split into `ME` (`my_*`) and `ALL` (`all_*`) scope
columns (no charts). The user multi-selects scoped metrics (`all_*` / `my_*`) and picks one
as the hero via a dedicated `hero` field; the rest fill auto-capped per-scope lists. The
serverless emits each card as `{ key, label, name, scope, value }` — `name` is the
scope-stripped label ("Open") so the column header carries the scope, `scope` drives the
split. Hero falls back to `cards[0]` when the `hero` field is blank.

## Data Source

- **Strategy:** `serverless` (Node.js, network-enabled, 128 MB / 5 s). `serverless.js` is
  the reference copy; it must be pasted into the plugin's serverless editor (not auto-deployed
  from this repo). Entry point: `run(input)`.
- **Why serverless, not polling/worker:** HappyFox has no multi-count endpoint; TRMNL polls
  one URL with a **100 KB payload cap**. The serverless function fans out one `size=1` query
  per selected metric and reads only the count, so the queue size never matters and the API
  secret stays server-side. A Cloudflare Worker (extra infra) and the Reports API (no date
  filters, no per-agent scoping) were both rejected.
- Output (top-level merge vars, since it's a single source): `cards` (ordered
  `[{key,label,value}]`), `updated` (ISO-8601 UTC), `error`. See `hf.sample.json`.

## HappyFox API — verified live (hopecollege.happyfox.com, 2026-06-26)

Endpoint `…/api/1.1/json/tickets/`, HTTP Basic auth (`apiKey:authCode`). These were confirmed
against the real instance — trust them over the PDF docs in `Docs/` where they differ:

- **Grand total = `page_info.last_index`.** (`count` is the current-page size; `page_count`
  is the page count — neither is the total.) Query with `size=1` to keep payloads tiny.
- **Behavior filters work:** `status=_pending` returns all pending-behavior tickets
  regardless of custom status names; `status=_all` is everything. Statuses each carry a
  `behavior` of `pending` or `completed`.
- **Unassigned = `q=unassigned:true`.** The documented `assignee:--none` / `assignee:--any`
  keywords return 0 here — do **not** use them. `assignee:"<email>"` works for the My scope.
- **q encoding:** join search items with a **literal `+`** (HappyFox decodes it to a space
  separator). Encode quotes as `%22`. **Never `encodeURIComponent` the whole `q`** — that
  turns `+` into `%2B` and the AND-combine silently matches nothing. `@ . / : -` are fine raw.
- Date filters use **yyyy/mm/dd**; `serverless.js` computes "today" in the user's IANA tz.
- Edge case: the My-scope `agent` value has spaces converted to `+` (HappyFox decodes `+`→space
  inside quoted values), so full names work. A literal `+` in a *plus-addressed* email
  (`you+desk@acme.com`) would be read as a space — use the plain agent email/username instead.
- Quirk: bare `status=_all` with no `q` returns an **empty body**, but `_all` **with** a `q`
  (created/closed metrics) works fine — so always pair `_all` with a query.
- Local test harness: `node` against `serverless.js` with creds from `.dev.vars` (read-only
  GETs) — handy to re-verify counts without TRMNL.

## Template Structure

All rendering lives in `shared.liquid`; the four size files are one-line wrappers that
`{% render 'main', ... %}` with a `layout_size`, passing `cards` / `updated` / `error`
through (template partial scope is isolated — pass everything the partial needs). Templates:

- `main` — derives `hour12` from the `timemode` custom field, handles the
  empty/error state, resolves the hero (the card whose `key` matches the `hero` field, else
  `cards[0]`), splits the rest into `my`/`all` via `cards | where: 'scope', …`, then branches
  per `layout_size`. The `my_count`/`all_count` guards (scope size minus the hero if it lives
  in that scope) hide an empty column header.
- `scope_group` — the single labeled scope template (replaces the old `scope_column` /
  `scope_row`): a `Me`/`All` header over the scope's non-hero cards, capped in
  Liquid at `item_limit` with a hand-rendered "+N more" tail (`total_count` precomputed). The
  caller passes `inner_class` to lay the cards out — `grid grid--cols-6` (full, item_limit 5)
  or `grid grid--cols-5` (half-horizontal, item_limit 4). The grids make the two scope rows
  align column-to-column. (half-vertical uses `overflow_scope` instead, below.) The root carries
  `self--stretch` (the parent `flex--col` sets `align-items:center`, so a short row would
  otherwise shrink + center) and the header `self--start` keeps it left while the row fills
  width. NB: the framework `list` auto-cap engine (`data-list-limit` etc.) did **not**
  initialize reliably nested in a `grid` scope_group — it swallowed the header and didn't cap —
  so capping there is explicit Liquid. `quadrant` also uses `scope_group`: the `Me`/`All` groups
  (a `grid grid--cols-2` inner, item_limit 2) sit beside the hero in a landscape slot but stack
  under it in portrait via `portrait:flex--col` on the outer row. That orientation flip is the
  truncation fix — a hero-on-the-left in the ~240px-wide portrait frame squeezed cards to ~60px
  ("Open"→"Oper"); stacking hands them the full width. (quadrant can stay static where half-vertical
  can't because its two mounts are opposite orientations — landscape 400x240 vs portrait 240x400 —
  each a fixed size `portrait:` distinguishes, whereas half-vertical is portrait-shaped in both.)
  The scope header carries the scope so card labels stay scope-stripped ("Open", not "All Open").
- `overflow_scope` — the half-vertical scope template: a labeled `.list` column handed to the
  framework overflow engine (`data-overflow` + `-max-height="auto"` + `-counter`), which shows
  as many cards as fit the real portrait height and appends "and N more" itself. half-vertical
  is the one size that must FILL the height, so it diverges from `scope_group`'s static cap.
- `card` — one stat (`item`/`meta`/`content` with a `value` + `label`). `label_text` overrides
  the shown label (`scope_group` passes `card.name`, the scope-stripped form; the hero uses
  full `card.label`). Sizes passed in (`value_size`, `label_size`) with `lg:` variants for TRMNL X.
- `title_bar` — inline HappyFox logo mark (from `hf-logo-light.svg`, brand orange
  `fill="#ff5a00"`), instance name, and the "Updated" time. The time is emitted as a
  `<span data-dt="{epoch}" data-dt-style="time">`; a `<script>` at the end of `main`
  formats every `[data-dt]` with `Intl.DateTimeFormat` in the user's `locale` /
  `time_zone_iana`, forcing `hour12` from the `timemode` field. This keeps the display
  DST-correct and locale-aware (same approach as `nws-severe-weather`).

## Design / framework notes

- Follows the design-system "values type — large hero numbers" pattern: hero
  `value--xxxlarge`/`giga` + `divider` + scope groups of smaller `item` cards, each scope a
  plain `Me`/`All` header over a grid of cards. Full stacks two `grid--cols-6`
  bands (so ME/ALL columns line up); half-horizontal puts the hero on the left and stacks
  the two scopes as `grid--cols-5` rows that fill the width; half-vertical puts the two
  scopes side by side as overflow-capped `.list` columns. The body values step down from the
  hero (`value--large`/`small`/`base`) so the chosen hero clearly dominates.
- `data-value-format="true"` auto-abbreviates big counts (e.g. 1234 → 1.2k); `value--tnums`
  keeps digits tabular. `data-clamp` truncates long labels.
- Null card values render as "—" via `| default: '—'` (0 is preserved — it's not nil).
- The empty `<div class="meta"></div>` is intentional: `.meta` paints the decorative gray bar
  beside each number. Don't remove it.

## Framework gotchas (ground truth = the compiled CSS, not the docs)

`framework_3.1.1_plugins.css` / `.js` / `.md` in the repo root are the **full** v3.1.1
framework (grep these first when verifying a class). The older `framework_v3.1.1.css` is a
**partial** and is missing classes the live framework has (`justify--*`,
`label--xsmall`, the `data-*` attributes). (Note: `value--medium` and a `text--uppercase`
utility do **not** exist in the full framework either — grep before relying on a class.) Note: the framework ships **no** rotate /
`writing-mode` / vertical-text utility — confirmed by grepping the full CSS+JS. (This is why
an earlier full-view design used rotated vertical ME/ALL tabs via a custom `.hf-scope-tab`
`<style>` rule; that has since been dropped in favor of plain headers, so the plugin now uses
framework classes only — no `<style>` block.) Also confirmed in the CSS: `.flex--col` sets
`align-items:center`, so a flex column centers (and shrinks) short children — use
`self--stretch` on a child to force full width (this is why `scope_group` carries it). When
verifying a class, prefer (1) the full framework files here, then (2) what a deployed sibling
plugin uses, then (3) the skill's `template_guide.md`, then (4) `https://trmnl.com/css/latest/plugins.css`. Other repo-wide
gotchas (`.layout` clips not scrolls; `stretch` for grow+shrink; `flex--center-*` are
direction-aware; no `lg:h--`) are documented in `../ham-radio-solar-weather/CLAUDE.md`.

## Vestaboard

A Vestaboard Flagship cannot render HTML, so it gets a Composer composition instead of the
four sizes. `vestaboard.json` is the plugin's `vestaboard_canvas` (`{id, name, width: 22,
height: 6, background, layers}`). Its one text layer (`font: "vestaboard"`, `wrap_mode: "box"`,
`box_width: 22`) holds the Liquid in `vestaboard.liquid`, which is the source of truth.

- Rebuild and upload after editing the Liquid:
  `jq --rawfile t vestaboard.liquid '.layers[0].text = $t' vestaboard.json > vb.tmp && mv vb.tmp vestaboard.json`,
  then MCP `writeMarkup` with `size: vestaboard_canvas` and the compact JSON as `content`.
- Text renders against the same merge variables, then one flap per character: `A-Z`, `0-9`
  and `! @ # $ ( ) - + & = ; : ' " % , . / ? °`. Lowercase is uppercased. Anything else, such
  as accented letters, emoji and the em-dash, is a blank flap. `{63}`-`{69}` become red,
  orange, yellow, green, blue, violet and white flaps.
- Every tag trims whitespace, so literal spaces are `{{ ' ' }}` and padding uses `slice`
  against a 22-space string. A `{64}` token is four characters in Liquid but one cell, so pad
  before inserting it.
- Keep `{64}` as template text, never inside `{{ }}`. Ruby Liquid ends an output tag at the
  first closing brace, so `{{ '{64}' }}` is a syntax error on TRMNL. liquidjs and python-liquid
  both miss this, so check changes with the `liquid` gem (`ruby:3.4-alpine` under podman).
- Box wrap leaves lines of 22 or fewer cells alone and word-wraps longer ones, which only the
  error message needs. Rows past the sixth are dropped.
- Layout ground truth is TRMNL's public Composer code, `/assets/lib/vestaboard_board-*.js` and
  `composition_font_atlas-*.js`, which mirror the server compositor.
- `startPreview` rejects the `vestaboard` model, so there is no server preview. Unverified until
  rendered on a real board: TRMNL's server render, and whether
  `trmnl.plugin_settings.custom_fields_values.hero` reaches composition layers. Without it the
  hero falls back to `cards[0]`.

## Development Guidelines

1. Keep all e-ink rendering in `shared.liquid`; size files stay one-liners. The Vestaboard
   layout lives in `vestaboard.liquid`.
2. Tailor each size — drop the grid tail (`limit`) rather than overflow; `.layout` clips.
3. Guard every `{{ }}`; `cards` can be empty and any `value` can be `null`.
4. Keep the title_bar icon inline (no network URLs — they can fail on-device).
5. No inline styles, no emojis, no custom CSS — framework classes only. (The template now
   holds to this with no exceptions; the old `.hf-scope-tab` `<style>` rotate hack is gone.)
   For alignment quirks reach for `self--stretch` / `self--start` / grid columns, not CSS.
6. `.dev.vars` holds live API creds for testing and must never be committed.
