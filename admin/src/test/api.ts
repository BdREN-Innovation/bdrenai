import { vi } from 'vitest';

export interface MockRequest {
  method: string;
  path: string;
  query: URLSearchParams;
  body: unknown;
  headers: Record<string, string>;
}

export type MockReply = { status?: number; body?: unknown };
export type Handler = (request: MockRequest) => MockReply | unknown;
export type Routes = Record<string, Handler | unknown>;

/** A JSON body that is a reply envelope rather than plain data. */
export const reply = (status: number, body?: unknown): MockReply & { __reply: true } => ({ status, body, __reply: true });

const isReply = (value: unknown): value is MockReply & { __reply: true } =>
  typeof value === 'object' && value !== null && '__reply' in value;

/**
 * Stubs window.fetch, the network boundary. Routes are keyed "METHOD /path/" (no query string);
 * a value is either the JSON body or a handler returning it (or reply(status, body)).
 */
export function mockApi(routes: Routes) {
  const calls: MockRequest[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(String(input), 'http://localhost');
    const method = (init.method ?? 'GET').toUpperCase();
    const headers = Object.fromEntries(Object.entries((init.headers ?? {}) as Record<string, string>));
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
    const request: MockRequest = { method, path: url.pathname, query: url.searchParams, body, headers };
    calls.push(request);
    const key = `${method} ${url.pathname}`;
    if (!(key in routes)) return new Response(JSON.stringify({ error: 'not_found', message: key }), { status: 404 });
    const route = routes[key];
    const result = typeof route === 'function' ? (route as Handler)(request) : route;
    const { status, body: payload } = isReply(result) ? result : { status: 200, body: result };
    return new Response(payload === undefined ? null : JSON.stringify(payload), {
      status: status ?? 200,
      headers: { 'Content-Type': 'application/json' },
    });
  });
  vi.stubGlobal('fetch', fetchMock);
  return {
    calls,
    find: (method: string, path: string) => calls.filter((call) => call.method === method && call.path === path),
  };
}
