import { requireAuth, jsonResponse } from '../_auth.js';

export async function onRequestGet(context) {
  const { request, env } = context;
  const auth = await requireAuth(request, env);
  if (!auth.ok) return auth.response;
  return jsonResponse({ ok: true });
}
