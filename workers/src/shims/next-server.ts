// Minimal Next.js-compatible shims so the shared handlers run on Workers.
export class NextRequest extends Request {
  nextUrl: { searchParams: URLSearchParams; pathname: string };
  cookies: { getAll: () => unknown[] };
  constructor(input: RequestInfo | URL, init?: RequestInit) {
    super(input as RequestInfo, init);
    const u = new URL(this.url);
    this.nextUrl = { searchParams: u.searchParams, pathname: u.pathname };
    this.cookies = { getAll: () => [] };
  }
  json(): Promise<any> {
    return super.json() as Promise<any>;
  }
}

export const NextResponse = {
  json(body: unknown, init?: { status?: number; headers?: Record<string, string> }) {
    return new Response(JSON.stringify(body), {
      status: init?.status ?? 200,
      headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    });
  },
  redirect(url: string, status = 307) {
    return Response.redirect(url, status);
  },
};
