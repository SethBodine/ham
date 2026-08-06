import { requireAuth, jsonResponse, badRequest } from '../../_auth.js';

const MAX_BODY_BYTES = 20 * 1024; // 20KB per entry is generous for a log line + extra fields
const MAX_ENTRIES_LIST = 5000;    // sanity ceiling on a single list operation
const RESERVED_KEYS = new Set(['id', 'createdAt', 'updatedAt']);

function sanitizeString(v, maxLen) {
  if (typeof v !== 'string') return '';
  // Strip control characters (except normal whitespace) and cap length.
  return v.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').slice(0, maxLen);
}

function sanitizeEntryFields(input) {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return null;
  }
  const out = {};
  let count = 0;
  for (const [key, value] of Object.entries(input)) {
    if (RESERVED_KEYS.has(key)) continue;
    if (count >= 60) break; // cap number of fields per entry
    const safeKey = sanitizeString(key, 64);
    if (!safeKey) continue;
    if (typeof value === 'string') {
      out[safeKey] = sanitizeString(value, 2000);
    } else if (typeof value === 'number' || typeof value === 'boolean' || value === null) {
      out[safeKey] = value;
    } else {
      continue; // skip nested objects/arrays — keep entries flat & predictable
    }
    count++;
  }
  return out;
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const auth = await requireAuth(request, env);
  if (!auth.ok) return auth.response;

  const prefix = `entry:${auth.operatorId}:`;
  const entries = [];
  let cursor;
  do {
    const list = await env.LOGBOOK.list({ prefix, cursor, limit: 1000 });
    for (const key of list.keys) {
      const raw = await env.LOGBOOK.get(key.name);
      if (raw) {
        try { entries.push(JSON.parse(raw)); } catch (e) { /* skip corrupt record */ }
      }
      if (entries.length >= MAX_ENTRIES_LIST) break;
    }
    cursor = list.list_complete ? undefined : list.cursor;
  } while (cursor && entries.length < MAX_ENTRIES_LIST);

  entries.sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
  return jsonResponse({ entries });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const auth = await requireAuth(request, env);
  if (!auth.ok) return auth.response;

  const contentType = request.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    return badRequest('Expected application/json body.');
  }

  const rawBody = await request.text();
  if (rawBody.length > MAX_BODY_BYTES) {
    return badRequest('Entry payload too large.');
  }

  let parsed;
  try {
    parsed = JSON.parse(rawBody);
  } catch (e) {
    return badRequest('Invalid JSON.');
  }

  const fields = sanitizeEntryFields(parsed);
  if (fields === null) return badRequest('Entry must be a JSON object.');

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const entry = Object.assign({}, fields, { id, createdAt: now, updatedAt: now });

  await env.LOGBOOK.put(`entry:${auth.operatorId}:${id}`, JSON.stringify(entry));
  return jsonResponse({ entry }, { status: 201 });
}
