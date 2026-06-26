/**
 * HappyFox -> TRMNL serverless aggregator.
 *
 * Runtime: TRMNL Serverless (Node.js, network enabled, 128 MB / 5 s). Paste the whole
 * file into the plugin's Serverless editor; the platform calls `run(input)` and exposes
 * the returned object's keys as merge variables (`cards`, `updated`, `error`).
 *
 * It turns the user's selected metrics into one small, ordered `cards` array of
 * { key, label, value } — far under TRMNL's 100 KB payload cap regardless of queue size,
 * because every query asks for `size=1` and we only read the count from the pagination
 * metadata. The markup renders cards[0] as the hero and the rest as a stat grid.
 *
 * Verified live against hopecollege.happyfox.com (2026-06-26):
 *   - grand total lives in `page_info.last_index`
 *   - "unassigned" is `unassigned:true` (the documented assignee:--none / --any return 0 here)
 *   - search items combine with a LITERAL '+' (HappyFox decodes it to a space separator);
 *     blanket-encoding the query turns '+' into '%2B' and the AND-combine matches nothing.
 */

// Single source of truth: base metric -> { status, q, label, allOnly? }.
// "{today}" is replaced with yyyy/mm/dd in the user's tz. `allOnly: true` means there's
// no "My ..." variant (a My-scoped unassigned set is always empty). Object insertion
// order defines the canonical card render order. To add a metric, edit only this map
// (and the matching option in the README form-builder list).
const METRICS = {
  open: { status: '_pending', q: '', label: 'Open' },
  unassigned: { status: '_pending', q: 'unassigned:true', label: 'Unassigned', allOnly: true },
  due_today: { status: '_pending', q: 'duedate:today', label: 'Due Today' },
  past_due: { status: '_pending', q: 'duedate:overdue', label: 'Past Due' },
  created_today: { status: '_all', q: 'created-on:"{today}"', label: 'Created Today' },
  closed_today: { status: '_all', q: 'last-closed-on-or-after:"{today}"', label: 'Closed Today' },
  breached: { status: '_pending', q: 'breached:true', label: 'SLA Breached' },
  unresponded: { status: '_pending', q: 'unresponded:true', label: 'Unresponded' },
};

// Derived canonical order: all_<k> (+ my_<k> unless allOnly), in map order.
const METRIC_ORDER = Object.entries(METRICS).flatMap(
  ([k, def]) => (def.allOnly ? ['all_' + k] : ['all_' + k, 'my_' + k])
);

// yyyy/mm/dd in the user's timezone (HappyFox date filters expect yyyy/mm/dd).
function todayInTz(iana) {
  try {
    const ymd = new Intl.DateTimeFormat('en-CA', {
      timeZone: iana || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date()); // en-CA -> yyyy-mm-dd
    return ymd.replace(/-/g, '/');
  } catch (e) {
    return new Date().toISOString().slice(0, 10).replace(/-/g, '/');
  }
}

// Accept an array, or a comma/space separated string; de-dupe and return in canonical order.
function selectedMetrics(metrics) {
  let list = [];
  if (Array.isArray(metrics)) list = metrics;
  else if (typeof metrics === 'string') list = metrics.split(/[\s,]+/);
  const set = new Set(list.map((m) => String(m).trim().toLowerCase()).filter(Boolean));
  return METRIC_ORDER.filter((k) => set.has(k));
}

// Join search items with a literal '+' and encode only the quotes. Do NOT
// encodeURIComponent the whole thing — that breaks the '+' item separator.
function buildQ(parts) {
  return parts.filter(Boolean).join('+').replace(/"/g, '%22');
}

async function run(input) {
  const settings = (input && input.trmnl && input.trmnl.plugin_settings) || {};
  const cf = settings.custom_fields_values || {};

  const accountUrl = String(cf.account_url || '').trim().replace(/\/+$/, '');
  const apiKey = String(cf.api_key || '').trim();
  const authCode = String(cf.auth_code || '').trim();
  const agent = String(cf.agent || '').trim().replace(/ /g, '+'); // spaces -> + for HappyFox
  const selected = selectedMetrics(cf.metrics);

  const tz = input && input.trmnl && input.trmnl.user && input.trmnl.user.time_zone_iana;
  const today = todayInTz(tz);
  const updated = new Date().toISOString();

  if (!accountUrl || !apiKey || !authCode) {
    return { cards: [], updated, error: 'Set the HappyFox account URL, API key, and auth code.' };
  }
  if (!selected.length) {
    return { cards: [], updated, error: 'Select at least one metric.' };
  }
  if (selected.some((k) => k.startsWith('my_')) && !agent) {
    return { cards: [], updated, error: 'A "My ..." metric needs an agent email.' };
  }

  const auth = 'Basic ' + Buffer.from(apiKey + ':' + authCode).toString('base64');
  const endpoint = accountUrl + '/api/1.1/json/tickets/';

  async function total(status, q) {
    const url = endpoint + '?status=' + status + '&size=1' + (q ? '&q=' + q : '');
    const res = await fetch(url, { headers: { Authorization: auth, Accept: 'application/json' } });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const body = await res.json();
    const pi = (body && body.page_info) || {};
    return typeof pi.last_index === 'number' ? pi.last_index : null;
  }

  // Only the selected metrics are queried, all in parallel (well under the 5 s cap).
  const cards = await Promise.all(selected.map(async (key) => {
    const isMine = key.startsWith('my_');
    const baseKey = key.replace(/^(my_|all_)/, '');
    const def = METRICS[baseKey];
    const label = (isMine ? 'My ' : 'All ') + (def ? def.label : baseKey);
    if (!def) return { key, label, value: null };

    const parts = [];
    if (def.q) parts.push(def.q.replace('{today}', today));
    if (isMine) parts.push('assignee:"' + agent + '"');

    try {
      return { key, label, value: await total(def.status, buildQ(parts)) };
    } catch (e) {
      return { key, label, value: null };
    }
  }));

  // If every query failed (bad creds, DNS, outage), surface it instead of a grid of dashes.
  if (cards.every((c) => c.value === null)) {
    return { cards: [], updated, error: 'Could not reach HappyFox.' };
  }

  return { cards, updated, error: null };
}

// TRMNL serverless entry point.
module.exports = { run };
