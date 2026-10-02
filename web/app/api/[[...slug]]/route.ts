import { NextRequest } from 'next/server';

// Single catch-all API router: collapses the 19 route handlers into ONE
// serverless function so the portal stays far under Vercel's free-tier
// 12-function cap. The URL paths are unchanged for every caller.

import {
  GET as ownerRetailersGet,
  POST as ownerRetailersPost,
} from '@/lib/apiHandlers/ownerRetailers';
import { PATCH as ownerRetailerPatch } from '@/lib/apiHandlers/ownerRetailer';
import { POST as ownerCreditsPost } from '@/lib/apiHandlers/ownerCredits';
import { POST as ownerAllowancesPost } from '@/lib/apiHandlers/ownerAllowances';
import { GET as ownerAuditGet } from '@/lib/apiHandlers/ownerAudit';
import { POST as ownerTotpPost } from '@/lib/apiHandlers/ownerTotp';
import { POST as ownerPinPost } from '@/lib/apiHandlers/ownerPin';
import {
  GET as retailerCustomersGet,
  POST as retailerCustomersPost,
} from '@/lib/apiHandlers/retailerCustomers';
import { POST as consentPost } from '@/lib/apiHandlers/consent';
import { POST as enrollmentPost } from '@/lib/apiHandlers/enrollment';
import {
  GET as paymentsGet,
  POST as paymentsPost,
} from '@/lib/apiHandlers/payments';
import { GET as schedulesGet } from '@/lib/apiHandlers/schedules';
import { GET as enrollmentGet } from '@/lib/apiHandlers/enrollmentGet';
import { GET as retailerDevicesGet } from '@/lib/apiHandlers/retailerDevices';
import { POST as commandProxyPost } from '@/lib/apiHandlers/commandProxy';
import { POST as commandsPost } from '@/lib/apiHandlers/commands';
import { POST as registerPost } from '@/lib/apiHandlers/register';
import { POST as heartbeatPost } from '@/lib/apiHandlers/heartbeat';
import { POST as ackPost } from '@/lib/apiHandlers/ack';
import { POST as retailerUnlockKeyPost } from '@/lib/apiHandlers/retailerUnlockKey';
import { POST as customerPhotoPost } from '@/lib/apiHandlers/customerPhoto';

export const dynamic = 'force-dynamic';

type Handler = (req: NextRequest, ctx: { params: Record<string, string> }) => Promise<Response>;

interface RouteDef {
  segments: number;
  match: (p: string[]) => boolean;
  get?: Handler;
  post?: Handler;
  patch?: Handler;
}

function seg(id: string) {
  return (p: string[], i: number): boolean => p[i] === id;
}

const ROUTES: RouteDef[] = [
  { segments: 2, match: (p) => seg('owner')(p, 0) && seg('retailers')(p, 1), get: ownerRetailersGet, post: ownerRetailersPost },
  { segments: 3, match: (p) => seg('owner')(p, 0) && seg('retailers')(p, 1), patch: (req, ctx) => ownerRetailerPatch(req, { params: { id: ctx.params.id } }) },
  { segments: 4, match: (p) => seg('owner')(p, 0) && seg('retailers')(p, 1) && seg('credits')(p, 3), post: (req, ctx) => ownerCreditsPost(req, { params: { id: ctx.params.id } }) },
  { segments: 4, match: (p) => seg('owner')(p, 0) && seg('retailers')(p, 1) && seg('allowances')(p, 3), post: (req, ctx) => ownerAllowancesPost(req, { params: { id: ctx.params.id } }) },
  { segments: 2, match: (p) => seg('owner')(p, 0) && seg('audit')(p, 1), get: ownerAuditGet },
  { segments: 4, match: (p) => seg('owner')(p, 0) && seg('devices')(p, 1) && seg('totp')(p, 3), post: (req, ctx) => ownerTotpPost(req, { params: { id: ctx.params.id } }) },
  { segments: 4, match: (p) => seg('owner')(p, 0) && seg('devices')(p, 1) && seg('pin')(p, 3), post: (req, ctx) => ownerPinPost(req, { params: { id: ctx.params.id } }) },
  { segments: 2, match: (p) => seg('retailer')(p, 0) && seg('customers')(p, 1), get: retailerCustomersGet, post: retailerCustomersPost },
  { segments: 4, match: (p) => seg('retailer')(p, 0) && seg('customers')(p, 1) && seg('consent')(p, 3), post: (req, ctx) => consentPost(req, { params: { id: ctx.params.id } }) },
  { segments: 4, match: (p) => seg('retailer')(p, 0) && seg('customers')(p, 1) && seg('enrollment')(p, 3), post: (req, ctx) => enrollmentPost(req, { params: { id: ctx.params.id } }) },
  { segments: 4, match: (p) => seg('retailer')(p, 0) && seg('customers')(p, 1) && seg('payments')(p, 3), get: (req, ctx) => paymentsGet(req, { params: { id: ctx.params.id } }), post: (req, ctx) => paymentsPost(req, { params: { id: ctx.params.id } }) },
  { segments: 4, match: (p) => seg('retailer')(p, 0) && seg('customers')(p, 1) && seg('schedules')(p, 3), get: (req, ctx) => schedulesGet(req, { params: { id: ctx.params.id } }) },
  { segments: 4, match: (p) => seg('retailer')(p, 0) && seg('customers')(p, 1) && seg('photo')(p, 3), post: (req, ctx) => customerPhotoPost(req, { params: { id: ctx.params.id } }) },
  { segments: 3, match: (p) => seg('retailer')(p, 0) && seg('enrollments')(p, 1), get: (req, ctx) => enrollmentGet(req, { params: { id: ctx.params.id } }) },
  { segments: 2, match: (p) => seg('retailer')(p, 0) && seg('devices')(p, 1), get: retailerDevicesGet },
  { segments: 3, match: (p) => seg('retailer')(p, 0) && seg('devices')(p, 1) && seg('command-proxy')(p, 2), post: commandProxyPost },
  { segments: 4, match: (p) => seg('retailer')(p, 0) && seg('devices')(p, 1) && seg('commands')(p, 3), post: (req, ctx) => commandsPost(req, { params: { id: ctx.params.id } }) },
  { segments: 4, match: (p) => seg('retailer')(p, 0) && seg('devices')(p, 1) && seg('unlock-key')(p, 3), post: (req, ctx) => retailerUnlockKeyPost(req, { params: { id: ctx.params.id } }) },
  { segments: 2, match: (p) => seg('device')(p, 0) && seg('register')(p, 1), post: registerPost },
  { segments: 2, match: (p) => seg('device')(p, 0) && seg('heartbeat')(p, 1), post: heartbeatPost },
  { segments: 3, match: (p) => seg('device')(p, 0) && seg('command')(p, 1) && seg('ack')(p, 2), post: ackPost },
  { segments: 1, match: (p) => seg('health')(p, 0), get: async () => Response.json({ ok: true, at: new Date().toISOString() }) },
];

export async function GET(req: NextRequest, ctx: { params: { slug?: string[] } }) {
  return dispatch(req, ctx, 'get');
}

export async function POST(req: NextRequest, ctx: { params: { slug?: string[] } }) {
  return dispatch(req, ctx, 'post');
}

export async function PATCH(req: NextRequest, ctx: { params: { slug?: string[] } }) {
  return dispatch(req, ctx, 'patch');
}

function dispatch(
  req: NextRequest,
  ctx: { params: { slug?: string[] } },
  method: 'get' | 'post' | 'patch',
): Promise<Response> {
  const parts = ctx.params.slug ?? [];
  if (parts.length === 0) {
    return Promise.resolve(Response.json({ ok: true, name: 'emidost-api' }));
  }
  // Path params: the only dynamic segments are ids at fixed positions.
  const params: Record<string, string> = {};
  for (const def of ROUTES) {
    if (def.segments !== parts.length || !def.match(parts)) continue;
    if (def.segments === 3 && parts[0] === 'owner' && parts[1] === 'retailers') params.id = parts[2];
    if (def.segments === 4 && parts[3] === 'credits') params.id = parts[2];
    if (def.segments === 4 && parts[3] === 'allowances') params.id = parts[2];
    if (def.segments === 4 && parts[3] === 'totp') params.id = parts[2];
    if (def.segments === 4 && parts[3] === 'pin') params.id = parts[2];
    if (def.segments === 4 && ['consent', 'enrollment', 'payments', 'schedules'].includes(parts[3])) params.id = parts[2];
    if (def.segments === 3 && parts[0] === 'retailer' && parts[1] === 'enrollments') params.id = parts[2];
    if (def.segments === 4 && parts[3] === 'commands') params.id = parts[2];
    if (def.segments === 4 && parts[3] === 'unlock-key') params.id = parts[2];
    if (def.segments === 4 && parts[3] === 'photo') params.id = parts[2];
    const handler = method === 'get' ? def.get : method === 'post' ? def.post : def.patch;
    if (handler) return handler(req, { params });
  }
  return Promise.resolve(Response.json({ error: 'not found' }, { status: 404 }));
}
