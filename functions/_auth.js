// Shared helpers for the call-log API (Cloudflare Pages Functions).
//
// Security notes (OWASP alignment):
// - Auth is a single bearer token compared using a constant-time-ish check
//   (we compare SHA-256 digests rather than raw strings, which avoids naive
//   short-circuit string comparison timing leaks).
// - The token itself is never logged or echoed back.
// - The token is hashed to derive an "operator" namespace for KV keys, so
//   multiple keys (multiple operators) can be supported later without any
//   data migration — each key already writes to its own prefix.

async function sha256Hex(input) {
  const enc = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', enc);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function constantTimeEqual(a, b) {
  // Compare fixed-length hex digests of both values so comparison time
  // does not depend on where the strings first differ.
  const [ha, hb] = await Promise.all([sha256Hex(a), sha256Hex(b)]);
  if (ha.length !== hb.length) return false;
  let diff = 0;
  for (let i = 0; i < ha.length; i++) {
    diff |= ha.charCodeAt(i) ^ hb.charCodeAt(i);
  }
  return diff === 0;
}

function unauthorized(message) {
  return new Response(JSON.stringify({ error: message || 'Unauthorized' }), {
    status: 401,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

/**
 * Verifies the request carries the correct bearer token in the
 * Authorization header, and returns an operator namespace derived from
 * the key (first 16 hex chars of its SHA-256 hash) for use in KV key
 * prefixes. Returns null (and the caller should return `unauthorized()`)
 * if the check fails.
 */
async function requireAuth(request, env) {
  const configuredKey = env.LOG_API_KEY;
  if (!configuredKey) {
    // Misconfiguration: fail closed, not open.
    return { ok: false, response: unauthorized('Server is not configured with an access key.') };
  }
  const header = request.headers.get('Authorization') || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    return { ok: false, response: unauthorized() };
  }
  const provided = match[1].trim();
  if (!provided || provided.length > 256) {
    return { ok: false, response: unauthorized() };
  }
  const valid = await constantTimeEqual(provided, configuredKey);
  if (!valid) {
    return { ok: false, response: unauthorized() };
  }
  const operatorId = (await sha256Hex(provided)).slice(0, 16);
  return { ok: true, operatorId };
}

function jsonResponse(data, init) {
  return new Response(JSON.stringify(data), Object.assign({
    headers: { 'content-type': 'application/json; charset=utf-8' },
  }, init));
}

function badRequest(message) {
  return jsonResponse({ error: message || 'Bad request' }, { status: 400 });
}

async function getFieldRegistry(env, operatorId) {
  const raw = await env.LOGBOOK.get(`fields:${operatorId}`);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return {};
    const byKey = {};
    parsed.forEach((f) => { if (f && f.key) byKey[f.key] = f; });
    return byKey;
  } catch (e) {
    return {};
  }
}

export { requireAuth, jsonResponse, badRequest, unauthorized, sha256Hex, getFieldRegistry };
