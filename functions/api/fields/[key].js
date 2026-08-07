import { requireAuth, jsonResponse } from '../../_auth.js';

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

export async function onRequestDelete(context) {
  const { request, env, params } = context;
  const auth = await requireAuth(request, env);
  if (!auth.ok) return auth.response;

  const key = decodeURIComponent(params.key || '');
  const registry = await getRegistry(env, auth.operatorId);
  const next = registry.filter((f) => f.key !== key);
  if (next.length === registry.length) {
    return jsonResponse({ error: 'Field not found.' }, { status: 404 });
  }
  await env.LOGBOOK.put(`fields:${auth.operatorId}`, JSON.stringify(next));
  return jsonResponse({ deleted: key, fields: next });
}
