import { NextRequest } from './shims/next-server';

// Single-entry Worker API: the exact dispatch table from the Next.js catch-all,
// reusing the shared handlers so every URL and behavior stays identical.
import {
  GET as ownerRetailersGet,
  POST as ownerRetailersPost,
} from '../../web/lib/apiHandlers/ownerRetailers';
import { PATCH as ownerRetailerPatch } from '../../web/lib/apiHandlers/ownerRetailer';
import { POST as ownerCreditsPost } from '../../web/lib/apiHandlers/ownerCredits';
import { POST as ownerAllowancesPost } from '../../web/lib/apiHandlers/ownerAllowances';
import { GET as ownerAuditGet } from '../../web/lib/apiHandlers/ownerAudit';
import { POST as ownerTotpPost } from '../../web/lib/apiHandlers/ownerTotp';
import { POST as ownerPinPost } from '../../web/lib/apiHandlers/ownerPin';
import {
  GET as retailerCustomersGet,
  POST as retailerCustomersPost,
} from '../../web/lib/apiHandlers/retailerCustomers';
import { POST as consentPost } from '../../web/lib/apiHandlers/consent';
import { POST as enrollmentPost } from '../../web/lib/apiHandlers/enrollment';
import {
  GET as paymentsGet,
  POST as paymentsPost,
} from '../../web/lib/apiHandlers/payments';
import { GET as schedulesGet } from '../../web/lib/apiHandlers/schedules';
import { GET as enrollmentGet } from '../../web/lib/apiHandlers/enrollmentGet';
import { GET as retailerDevicesGet } from '../../web/lib/apiHandlers/retailerDevices';
import { POST as commandProxyPost } from '../../web/lib/apiHandlers/commandProxy';
import { POST as commandsPost } from '../../web/lib/apiHandlers/commands';
import { POST as retailerUnlockKeyPost } from '../../web/lib/apiHandlers/retailerUnlockKey';
import { POST as registerPost } from '../../web/lib/apiHandlers/register';
import { POST as heartbeatPost } from '../../web/lib/apiHandlers/heartbeat';
import { POST as ackPost } from '../../web/lib/apiHandlers/ack';

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
  { segments: 3, match: (p) => seg('retailer')(p, 0) && seg('enrollments')(p, 1), get: (req, ctx) => enrollmentGet(req, { params: { id: ctx.params.id } }) },
  { segments: 2, match: (p) => seg('retailer')(p, 0) && seg('devices')(p, 1), get: retailerDevicesGet },
  { segments: 3, match: (p) => seg('retailer')(p, 0) && seg('devices')(p, 1) && seg('command-proxy')(p, 2), post: commandProxyPost },
  { segments: 4, match: (p) => seg('retailer')(p, 0) && seg('devices')(p, 1) && seg('commands')(p, 3), post: (req, ctx) => commandsPost(req, { params: { id: ctx.params.id } }) },
  { segments: 4, match: (p) => seg('retailer')(p, 0) && seg('devices')(p, 1) && seg('unlock-key')(p, 3), post: (req, ctx) => retailerUnlockKeyPost(req, { params: { id: ctx.params.id } }) },
  { segments: 2, match: (p) => seg('device')(p, 0) && seg('register')(p, 1), post: registerPost },
  { segments: 2, match: (p) => seg('device')(p, 0) && seg('heartbeat')(p, 1), post: heartbeatPost },
  { segments: 3, match: (p) => seg('device')(p, 0) && seg('command')(p, 1) && seg('ack')(p, 2), post: ackPost },
  { segments: 1, match: (p) => seg('health')(p, 0), get: async () => Response.json({ ok: true, at: new Date().toISOString(), host: 'workers' }) },
];

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const parts = url.pathname.split('/').filter((s) => s.length > 0);
    // Strip a leading /api prefix if routed with one; the app paths use /api/...
    const segs = parts[0] === 'api' ? parts.slice(1) : parts;
    if (segs.length === 0) return Response.json({ ok: true, name: 'emidost-api' });

    const req = new NextRequest(request);
    const params: Record<string, string> = {};
    for (const def of ROUTES) {
      if (def.segments !== segs.length || !def.match(segs)) continue;
      if (def.segments === 3 && segs[0] === 'owner' && segs[1] === 'retailers') params.id = segs[2];
      if (def.segments === 4 && ['credits', 'allowances', 'totp', 'pin', 'commands'].includes(segs[3])) params.id = segs[2];
      if (def.segments === 4 && ['consent', 'enrollment', 'payments', 'schedules', 'unlock-key'].includes(segs[3])) params.id = segs[2];
      if (def.segments === 3 && segs[0] === 'retailer' && segs[1] === 'enrollments') params.id = segs[2];
      const method = request.method.toLowerCase();
      const handler = method === 'get' ? def.get : method === 'post' ? def.post : method === 'patch' ? def.patch : undefined;
      if (handler) return handler(req, { params });
    }
    return Response.json({ error: 'not found', segs, method: request.method, table: ROUTES.length }, { status: 404 });
  },
};
