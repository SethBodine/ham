import { requireAuth, jsonResponse, badRequest } from '../_auth.js';

const MAX_BODY_BYTES = 4 * 1024;

function sanitizeString(v, maxLen) {
  if (typeof v !== 'string') return '';
  return v.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').slice(0, maxLen);
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const auth = await requireAuth(request, env);
  if (!auth.ok) return auth.response;

  const raw = await env.LOGBOOK.get(`settings:${auth.operatorId}`);
  const settings = raw ? JSON.parse(raw) : { stationCallsign: '' };
  return jsonResponse({ settings });
}

export async function onRequestPut(context) {
  const { request, env } = context;
  const auth = await requireAuth(request, env);
  if (!auth.ok) return auth.response;

  const contentType = request.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) return badRequest('Expected application/json body.');

  const rawBody = await request.text();
  if (rawBody.length > MAX_BODY_BYTES) return badRequest('Payload too large.');

  let parsed;
  try { parsed = JSON.parse(rawBody); } catch (e) { return badRequest('Invalid JSON.'); }

  const settings = {
    stationCallsign: sanitizeString(parsed.stationCallsign, 32),
  };

  await env.LOGBOOK.put(`settings:${auth.operatorId}`, JSON.stringify(settings));
  return jsonResponse({ settings });
}
