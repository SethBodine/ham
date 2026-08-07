import { requireAuth, jsonResponse, badRequest } from '../_auth.js';

const MAX_BODY_BYTES = 4 * 1024;
const MAX_FIELDS = 40;
const VALID_TYPES = new Set(['text', 'number', 'date']);
const RESERVED_KEYS = new Set([
  'id', 'createdAt', 'updatedAt',
  'callsign', 'date', 'time', 'frequency', 'mode', 'sigRcvd', 'sigSent', 'notes',
]);

function sanitizeString(v, maxLen) {
  if (typeof v !== 'string') return '';
  return v.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, maxLen);
}

async function getRegistry(env, operatorId) {
  const raw = await env.LOGBOOK.get(`fields:${operatorId}`);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    return [];
  }
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const auth = await requireAuth(request, env);
  if (!auth.ok) return auth.response;
  const fields = await getRegistry(env, auth.operatorId);
  return jsonResponse({ fields });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const auth = await requireAuth(request, env);
  if (!auth.ok) return auth.response;

  const contentType = request.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) return badRequest('Expected application/json body.');

  const rawBody = await request.text();
  if (rawBody.length > MAX_BODY_BYTES) return badRequest('Payload too large.');

  let parsed;
  try { parsed = JSON.parse(rawBody); } catch (e) { return badRequest('Invalid JSON.'); }

  const key = sanitizeString(parsed.key, 64);
  if (!key) return badRequest('Field name is required.');
  if (RESERVED_KEYS.has(key) || RESERVED_KEYS.has(key.charAt(0).toLowerCase() + key.slice(1))) {
    return badRequest('That field name is already one of the standard fields.');
  }

  const type = VALID_TYPES.has(parsed.type) ? parsed.type : 'text';
  let maxLength = parseInt(parsed.maxLength, 10);
  if (!Number.isFinite(maxLength) || maxLength <= 0) maxLength = 200;
  maxLength = Math.min(maxLength, 2000);

  const registry = await getRegistry(env, auth.operatorId);
  if (registry.some((f) => f.key.toLowerCase() === key.toLowerCase())) {
    return badRequest('A field with that name already exists.');
  }
  if (registry.length >= MAX_FIELDS) return badRequest('Field limit reached (' + MAX_FIELDS + ').');

  const field = { key, label: key, type, maxLength: type === 'text' ? maxLength : undefined };
  registry.push(field);
  await env.LOGBOOK.put(`fields:${auth.operatorId}`, JSON.stringify(registry));
  return jsonResponse({ field, fields: registry }, { status: 201 });
}
