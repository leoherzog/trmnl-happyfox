# HappyFox

A glanceable TRMNL e-ink dashboard for a [HappyFox](https://www.happyfox.com/) help desk.
You compose the screen from a flat list of scoped metrics — "All Open", "My Past Due",
"All Unresponded", etc. The first selected metric (in the list's order) becomes the big hero
number; the rest fill a stat-card grid, tailored to each of the four TRMNL sizes.

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
  description: The hero (big number) is the first selected metric in this list's order. Pick more than ~8 and smaller sizes drop the tail.
  multiple: true
  options:
    - "All Open": all_open
    - "My Open": my_open
    - "All Unassigned": all_unassigned
    - "All Due Today": all_due_today
    - "My Due Today": my_due_today
    - "All Past Due": all_past_due
    - "My Past Due": my_past_due
    - "All Created Today": all_created_today
    - "My Created Today": my_created_today
    - "All Closed Today": all_closed_today
    - "My Closed Today": my_closed_today
    - "All SLA Breached": all_breached
    - "My SLA Breached": my_breached
    - "All Unresponded": all_unresponded
    - "My Unresponded": my_unresponded
- keyname: timemode
  field_type: select
  name: Time format
  description: Used for the "Updated" timestamp.
  options:
    - "12-hour": 12_hour
    - "24-hour": 24_hour
```

> Option format: the TRMNL form builder takes each label/value pair as a single
> `"Label: value"` string (not a YAML mapping). The order of these options is also the
> on-screen order, and the first one you enable becomes the hero.

> If you pick any `My …` metric, fill in **My Agent Email**. Use the agent's email (HappyFox
> matches assignee by email / username / first / last name, case-sensitive exact match).

## Merge variables (serverless output)

| Variable | Type | Notes |
|----------|------|-------|
| `cards` | array | `[{ "key", "label", "value" }]`, in canonical option order. `value` is an integer, or `null` if that query failed (rendered as "—"). |
| `updated` | string | ISO-8601 UTC timestamp of the refresh. |
| `error` | string/null | A human-readable message when no cards could be produced (shown centered). |

## Layouts

| Size | Shows |
|------|-------|
| `full` (800×480) | Hero + up to 7 cards in a 4-col grid |
| `half-horizontal` (800×240) | Hero left + up to 3 cards right |
| `half-vertical` (400×480) | Hero + up to 5 cards in a 2-col grid |
| `quadrant` (400×240) | Hero + up to 2 cards |

## License

MIT
