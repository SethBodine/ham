import { requireAuth, jsonResponse, badRequest, getFieldRegistry } from '../../_auth.js';

const MAX_BODY_BYTES = 20 * 1024;
const RESERVED_KEYS = new Set(['id', 'createdAt', 'updatedAt']);
const ID_PATTERN = /^[a-f0-9-]{36}$/i; // crypto.randomUUID() shape
const DEFAULT_MAX_LEN = 2000;

function sanitizeString(v, maxLen) {
  if (typeof v !== 'string') return '';
  return v.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').slice(0, maxLen);
}

function sanitizeEntryFields(input, fieldRegistry) {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return null;
  const out = {};
  let count = 0;
  for (const [key, value] of Object.entries(input)) {
    if (RESERVED_KEYS.has(key)) continue;
    if (count >= 60) break;
    const safeKey = sanitizeString(key, 64);
    if (!safeKey) continue;
    if (typeof value === 'string') {
      const def = fieldRegistry[safeKey];
      const cap = def && def.type === 'text' && def.maxLength ? Math.min(def.maxLength, DEFAULT_MAX_LEN) : DEFAULT_MAX_LEN;
      out[safeKey] = sanitizeString(value, cap);
    } else if (typeof value === 'number' || typeof value === 'boolean' || value === null) out[safeKey] = value;
    else continue;
    count++;
  }
  return out;
}

export async function onRequestPut(context) {
  const { request, env, params } = context;
  const auth = await requireAuth(request, env);
  if (!auth.ok) return auth.response;

  const id = params.id;
  if (!ID_PATTERN.test(id)) return badRequest('Invalid entry id.');

  const contentType = request.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) return badRequest('Expected application/json body.');

  const rawBody = await request.text();
  if (rawBody.length > MAX_BODY_BYTES) return badRequest('Entry payload too large.');

  let parsed;
  try { parsed = JSON.parse(rawBody); } catch (e) { return badRequest('Invalid JSON.'); }

  const fieldRegistry = await getFieldRegistry(env, auth.operatorId);
  const fields = sanitizeEntryFields(parsed, fieldRegistry);
  if (fields === null) return badRequest('Entry must be a JSON object.');

  const key = `entry:${auth.operatorId}:${id}`;
  const existingRaw = await env.LOGBOOK.get(key);
  if (!existingRaw) return jsonResponse({ error: 'Entry not found.' }, { status: 404 });

  let existing;
  try { existing = JSON.parse(existingRaw); } catch (e) { existing = {}; }

  const merged = Object.assign({}, existing, fields);
  Object.keys(fields).forEach((k) => {
    if (fields[k] === null) delete merged[k];
  });

  const updated = Object.assign({}, merged, {
    id,
    createdAt: existing.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  await env.LOGBOOK.put(key, JSON.stringify(updated));
  return jsonResponse({ entry: updated });
}

export async function onRequestDelete(context) {
  const { request, env, params } = context;
  const auth = await requireAuth(request, env);
  if (!auth.ok) return auth.response;

  const id = params.id;
  if (!ID_PATTERN.test(id)) return badRequest('Invalid entry id.');

  const key = `entry:${auth.operatorId}:${id}`;
  const existing = await env.LOGBOOK.get(key);
  if (!existing) return jsonResponse({ error: 'Entry not found.' }, { status: 404 });

  await env.LOGBOOK.delete(key);
  return jsonResponse({ deleted: id });
}
