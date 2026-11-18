import { vi } from "vitest";

export interface Call {
  url: string;
  method: string;
  body: unknown;
}

export type Route = (url: string, method: string, body: unknown) => Response | undefined;

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

/** Replaces fetch at the network boundary: `route` answers each request, anything unanswered is a 404. */
export function mockApi(route: Route): Call[] {
  const calls: Call[] = [];
  vi.spyOn(global, "fetch").mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method || "GET";
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : init?.body;
    calls.push({ url, method, body });
    return route(url, method, body) || json({ error: "not_found" }, 404);
  });
  return calls;
}
