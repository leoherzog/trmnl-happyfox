# CLAUDE.md

Guidance for Claude Code working in this plugin.

## Project Overview

A TRMNL plugin that shows a glanceable HappyFox help-desk dashboard: a hero count plus a
grid of supporting data-point cards (no charts). The user composes the screen from a flat
multi-select of scoped metrics (`all_*` / `my_*`); `cards[0]` is the hero, the rest fill a
per-size-capped grid.

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
  empty/error state, then branches per `layout_size`. `cards[0]` = hero; `{% for card in
  cards offset: 1 limit: N %}` fills the grid (N caps per size).
- `card` — one stat card (`item`/`meta`/`content` with a `value` + `label`). Sizes are
  passed in (`value_size`, `label_size`) with `lg:` variants to scale up on TRMNL X.
- `title_bar` — inline HappyFox logo mark (from `hf-logo-light.svg`, brand orange
  `fill="#ff5a00"`), instance name, localized "Updated" time.

## Design / framework notes

- Follows the design-system "values type — large hero numbers" pattern: hero
  `value--xxxlarge` + `divider` + a grid of `value--small`-ish cards.
- `data-value-format="true"` auto-abbreviates big counts (e.g. 1234 → 1.2k); `value--tnums`
  keeps digits tabular. `data-clamp` truncates long labels.
- Null card values render as "—" via `| default: '—'` (0 is preserved — it's not nil).
- The empty `<div class="meta"></div>` is intentional: `.meta` paints the decorative gray bar
  beside each number. Don't remove it.

## Framework gotchas (ground truth = the compiled CSS, not the docs)

`framework_v3.1.1.css` in the repo root is a **partial** core file — it's missing utility
classes that the live framework (and the working sibling plugins) clearly have
(`justify--*`, `value--medium`, `label--xsmall`, the `data-*` attributes). When verifying a
class, prefer (1) what a deployed sibling plugin uses, then (2) the skill's
`template_guide.md`, then (3) `https://trmnl.com/css/latest/plugins.css`. Other repo-wide
gotchas (`.layout` clips not scrolls; `stretch` for grow+shrink; `flex--center-*` are
direction-aware; no `lg:h--`) are documented in `../ham-radio-solar-weather/CLAUDE.md`.

## Development Guidelines

1. Keep all rendering in `shared.liquid`; size files stay one-liners.
2. Tailor each size — drop the grid tail (`limit`) rather than overflow; `.layout` clips.
3. Guard every `{{ }}`; `cards` can be empty and any `value` can be `null`.
4. Keep the title_bar icon inline (no network URLs — they can fail on-device).
5. No inline styles, no emojis, no custom CSS — framework classes only.
6. `.dev.vars` holds live API creds for testing and must never be committed.
