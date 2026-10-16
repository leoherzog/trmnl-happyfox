# HappyFox

A glanceable TRMNL e-ink dashboard for a [HappyFox](https://www.happyfox.com/) help desk.
You pick the scoped metrics you care about — "All Open", "My Past Due", "All Unresponded",
etc. — and choose one as the **hero** (the big number up top). The rest split into two
columns: **ME** (your `my_*` metrics) and **ALL** (team-wide `all_*` metrics), each
tailored to the four TRMNL sizes.

All metrics are **behavior- and date-based**, so they work on any HappyFox instance
regardless of its custom status names (every status rolls up to either `pending` or
`completed` behavior):

| Metric | Meaning | HappyFox query |
|--------|---------|----------------|
| Open | Pending-behavior tickets | `status=_pending` |
| Unassigned | Pending tickets with no agent | `unassigned:true` |
| Due Today | Pending tickets due today | `duedate:today` |
| Past Due | Pending tickets past their due date | `duedate:overdue` |
| Created Today | Tickets created today | `created-on:"<today>"` |
| Closed Today | Tickets last closed today | `last-closed-on-or-after:"<today>"` |
| SLA Breached | Pending tickets that breached an SLA | `breached:true` |
| Unresponded | Pending tickets awaiting a first staff reply | `unresponded:true` |

`My …` variants add `assignee:"<agent>"`. (There is no "My Unassigned" — it's always empty.)

## How it works

HappyFox has no single multi-count endpoint, and TRMNL polls only one URL with a 100 KB
payload cap. So the data is assembled by a small **TRMNL Serverless** function
(`serverless.js`, Node.js, network-enabled) instead of a polling URL or an external worker:

1. It reads your custom fields and, for each **selected** metric, calls
   `…/api/1.1/json/tickets/?status=…&size=1&q=…`.
2. It reads the grand total from `page_info.last_index` (the `size=1` keeps every response
   tiny — the queue can have thousands of tickets and the payload stays a few hundred bytes).
3. It returns one ordered `cards` array. No external infrastructure, and the API secret
   never leaves TRMNL.

See `hf.sample.json` for the exact output shape the templates render.

## Setup

### 1. Get HappyFox API credentials

In HappyFox: **Manage → REST API** (or your account's API settings). Copy the **API key**
and **Auth code**. The API uses HTTP Basic auth (`apiKey:authCode`).

### 2. Create a Private Plugin (Serverless strategy)

1. New TRMNL Private Plugin → strategy **Serverless** (language: Node.js).
2. Paste the entire contents of `serverless.js` into the serverless editor.
3. Add the markup: paste `shared.liquid` into the shared/markup-shared area and the four
   size files (`full.liquid`, `half-horizontal.liquid`, `half-vertical.liquid`,
   `quadrant.liquid`) into their respective panes.
4. Set a polling/refresh interval (every 15–30 min is plenty; HappyFox allows 500 GET/min).

### 3. Custom fields (form builder)

```yaml
- keyname: account_url
  field_type: url
  name: HappyFox Account URL
  description: e.g. https://acme.happyfox.com (EU accounts use .happyfox.net; a custom domain also works). No trailing slash.
- keyname: api_key
  field_type: password
  name: API Key
- keyname: auth_code
  field_type: password
  name: Auth Code
- keyname: agent
  field_type: string
  name: My Agent Email
  description: The agent email used for any "My …" metric (e.g. you@acme.com).
  optional: true
- keyname: metrics
  field_type: select
  name: Metrics to show
  description: The data points to display. They split into ME / ALL columns below the hero; pick more than ~8 and smaller sizes show a "+N more" count.
  multiple: true
  options:
    - "All Open: all_open"
    - "My Open: my_open"
    - "All Unassigned: all_unassigned"
    - "All Due Today: all_due_today"
    - "My Due Today: my_due_today"
    - "All Past Due: all_past_due"
    - "My Past Due: my_past_due"
    - "All Created Today: all_created_today"
    - "My Created Today: my_created_today"
    - "All Closed Today: all_closed_today"
    - "My Closed Today: my_closed_today"
    - "All SLA Breached: all_breached"
    - "My SLA Breached: my_breached"
    - "All Unresponded: all_unresponded"
    - "My Unresponded: my_unresponded"
- keyname: hero
  field_type: select
  name: Hero metric (big number)
  description: The single metric shown as the large number up top. Leave blank to use your first selected metric. Always fetched even if it isn't ticked above.
  optional: true
  options:
    - "All Open: all_open"
    - "My Open: my_open"
    - "All Unassigned: all_unassigned"
    - "All Due Today: all_due_today"
    - "My Due Today: my_due_today"
    - "All Past Due: all_past_due"
    - "My Past Due: my_past_due"
    - "All Created Today: all_created_today"
    - "My Created Today: my_created_today"
    - "All Closed Today: all_closed_today"
    - "My Closed Today: my_closed_today"
    - "All SLA Breached: all_breached"
    - "My SLA Breached: my_breached"
    - "All Unresponded: all_unresponded"
    - "My Unresponded: my_unresponded"
- keyname: timemode
  field_type: select
  name: Time format
  description: Used for the "Updated" timestamp.
  options:
    - "12-hour: 12_hour"
    - "24-hour: 24_hour"
```

> Option format: the TRMNL form builder takes each label/value pair as a single
> `"Label: value"` string (not a YAML mapping). The order of these options is the
> on-screen order, and — within each scope — the column render order. The **Hero metric**
> field picks the big number independently; leave it blank to fall back to the first
> selected metric.

> If you pick any `My …` metric, fill in **My Agent Email**. Use the agent's email (HappyFox
> matches assignee by email / username / first / last name, case-sensitive exact match).

## Merge variables (serverless output)

| Variable | Type | Notes |
|----------|------|-------|
| `cards` | array | `[{ "key", "label", "name", "scope", "value" }]`, in canonical option order. `name` is the scope-stripped label ("Open"); `scope` is `"my"` or `"all"`. `value` is an integer, or `null` if that query failed (rendered as "—"). |
| `updated` | string | ISO-8601 UTC timestamp of the refresh. |
| `error` | string/null | A human-readable message when no cards could be produced (shown centered). |

## Layouts

Each size shows the **hero** (big number) plus the remaining metrics, split by scope into
`ME` / `ALL`. Each column caps to a per-size number of rows and shows a "+N more" line
when you've selected more than fit.

| Size | Layout |
|------|--------|
| `full` (800×480) | Hero on top, then `ME` and `ALL` as horizontal bands spanning the width |
| `half-horizontal` (800×240) | Hero on the left, `ME` and `ALL` as two stacked rows to the right |
| `half-vertical` (400×480) | Hero on top, then one row per metric with its `ME` and `ALL` counts side by side, or one scope's cards in two columns. Sizes scale with the row count to fill the slot. |
| `quadrant` (400×240) | Hero + the next four metrics (too small for labeled scopes) |

## Vestaboard

The plugin also runs on a [Vestaboard](https://help.trmnl.com/en/articles/17632479-vestaboard)
Flagship. A split-flap board cannot render HTML, so its layout is a TRMNL Composer composition,
`vestaboard.json`, whose one text layer holds the Liquid in `vestaboard.liquid`.

```
HAPPYFOX      ME   ALL
PAST DUE      #5    22
OPEN          40   746
UNASSIGNED           1
DUE TODAY      7    62
NEW TODAY      3    40
```

Each row is one metric, with the Me and All counts in fixed columns. The hero leads, and an
orange flap (`#` above) marks its count. Five metric rows fit, so any selected metric types past
the fifth are left off. Counts over 9,999 show in thousands ("12K"), and a failed query shows "-".

To install it, write `vestaboard.json` to the plugin's `vestaboard_canvas` through the TRMNL
MCP server (`writeMarkup`). You can also open **Edit Composition** with your Vestaboard as the
current device and paste `vestaboard.liquid` into a text layer set to box wrap, width 22.

## License

MIT
