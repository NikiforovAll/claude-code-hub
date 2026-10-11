import type { APIRoute } from 'astro';
import { url } from '../kit/family';
import { loadExtensions } from '../extensions/load';

export const GET: APIRoute = async ({ site }) => {
  const extensions = (await loadExtensions()).map((x) => ({
    ...x,
    page: new URL(url(`extensions/${x.id}/`), site).href,
  }));
  return new Response(JSON.stringify({ extensions }, null, 2), { headers: { 'Content-Type': 'application/json' } });
};
