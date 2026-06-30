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

- `main` — parses `updated` into a localized "Updated" time (respects the `timemode` custom
  field, same approach as `nws-severe-weather`/`ham-radio-solar-weather`), handles the
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
  initialize reliably nested here — it swallowed the header and didn't cap — so capping is
  explicit. `quadrant` skips `scope_group` (too small) and renders the hero + next four cards
  directly.
- `overflow_scope` — the half-vertical scope template: a labeled `.list` column handed to the
  framework overflow engine (`data-overflow` + `-max-height="auto"` + `-counter`), which shows
  as many cards as fit the real portrait height and appends "and N more" itself. half-vertical
  is the one size that must FILL the height, so it diverges from `scope_group`'s static cap.
- `card` — one stat (`item`/`meta`/`content` with a `value` + `label`). `label_text` overrides
  the shown label (`scope_group` passes `card.name`, the scope-stripped form; the hero uses
  full `card.label`). Sizes passed in (`value_size`, `label_size`) with `lg:` variants for TRMNL X.
- `title_bar` — inline HappyFox logo mark (from `hf-logo-light.svg`, brand orange
  `fill="#ff5a00"`), instance name, localized "Updated" time.

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

## Development Guidelines

1. Keep all rendering in `shared.liquid`; size files stay one-liners.
2. Tailor each size — drop the grid tail (`limit`) rather than overflow; `.layout` clips.
3. Guard every `{{ }}`; `cards` can be empty and any `value` can be `null`.
4. Keep the title_bar icon inline (no network URLs — they can fail on-device).
5. No inline styles, no emojis, no custom CSS — framework classes only. (The template now
   holds to this with no exceptions; the old `.hf-scope-tab` `<style>` rotate hack is gone.)
   For alignment quirks reach for `self--stretch` / `self--start` / grid columns, not CSS.
6. `.dev.vars` holds live API creds for testing and must never be committed.
