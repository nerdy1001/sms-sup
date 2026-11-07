import { afterEach, describe, expect, test, vi } from "vitest";
import { ApiError, request, type Parser } from "./client.ts";

const number: Parser<{ n: number }> = {
  parse(input) {
    if (typeof input === "object" && input !== null && "n" in input && typeof input.n === "number") return { n: input.n };
    throw new Error("not the expected shape");
  },
};

function answer(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}): Response {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), { status: init.status ?? 200, headers: init.headers ?? {} });
}

const stub = (implementation: (input: string, init?: RequestInit) => Promise<Response>) => vi.stubGlobal("fetch", vi.fn(implementation));
afterEach(() => vi.unstubAllGlobals());

async function failure(promise: Promise<unknown>): Promise<ApiError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ApiError) return error;
    throw error;
  }
  throw new Error("The request was expected to fail.");
}

describe("request: success", () => {
  test("returns the checked data", async () => {
    stub(() => Promise.resolve(answer({ n: 3 })));
    expect(await request("/x", number)).toEqual({ n: 3 });
  });

  test("asks for JSON, stays on the same address and sends a body as JSON", async () => {
    const calls: { input: string; init: RequestInit | undefined }[] = [];
    stub((input, init) => {
      calls.push({ input, init });
      return Promise.resolve(answer({ n: 1 }));
    });
    await request("/x", number, { method: "POST", body: { a: 1 } });
    const init = calls[0]?.init;
    expect(calls[0]?.input).toBe("/x");
    expect(init?.method).toBe("POST");
    expect(init?.credentials).toBe("same-origin");
    expect(init?.body).toBe('{"a":1}');
    expect(init?.headers).toMatchObject({ accept: "application/json", "content-type": "application/json" });
  });

  test("a request without a body sends no content type", async () => {
    let headers: unknown;
    stub((_input, init) => {
      headers = init?.headers;
      return Promise.resolve(answer({ n: 1 }));
    });
    await request("/x", number);
    expect(headers).toEqual({ accept: "application/json" });
  });

  test("only addresses on this site are allowed", async () => {
    stub(() => Promise.resolve(answer({ n: 1 })));
    await expect(request("https://elsewhere.example/x", number)).rejects.toThrow(/start with "\//);
  });
});

describe("request: failure", () => {
  const problem = { type: "urn:sms:error:forbidden", title: "Forbidden", status: 403, code: "forbidden", requestId: "req-12345678" };

  test("a problem document becomes an error with its code and reference", async () => {
    stub(() => Promise.resolve(answer(problem, { status: 403, headers: { "content-type": "application/problem+json" } })));
    const error = await failure(request("/x", number));
    expect(error.code).toBe("forbidden");
    expect(error.status).toBe(403);
    expect(error.requestId).toBe("req-12345678");
  });

  test("the problems found in the input are kept", async () => {
    const body = { ...problem, status: 400, code: "validation_failed", errors: [{ path: "body.email", code: "required" }] };
    stub(() => Promise.resolve(answer(body, { status: 400 })));
    const error = await failure(request("/x", number));
    expect(error.code).toBe("validation_failed");
    expect(error.fields).toEqual([{ path: "body.email", code: "required" }]);
  });

  test("an error answer that is not a problem document is an unexpected error that still carries its status and reference", async () => {
    stub(() => Promise.resolve(answer("<html>Bad gateway</html>", { status: 502, headers: { "x-request-id": "from-header-1" } })));
    const error = await failure(request("/x", number));
    expect(error.code).toBe("unexpected");
    expect(error.status).toBe(502);
    expect(error.requestId).toBe("from-header-1");
  });

  test("a code the front end does not know is not trusted", async () => {
    stub(() => Promise.resolve(answer({ ...problem, code: "teapot" }, { status: 418 })));
    expect((await failure(request("/x", number))).code).toBe("unexpected");
  });

  test("a connection that fails is a network error", async () => {
    stub(() => Promise.reject(new TypeError("Failed to fetch")));
    const error = await failure(request("/x", number));
    expect(error.code).toBe("network");
    expect(error.status).toBeUndefined();
  });

  test("an answer that is not JSON is unexpected", async () => {
    stub(() => Promise.resolve(answer("not json")));
    expect((await failure(request("/x", number))).code).toBe("unexpected");
  });

  test("an answer that does not match the contract is unexpected, and its content is not shown", async () => {
    stub(() => Promise.resolve(answer({ n: "three", secret: "do-not-show" })));
    const error = await failure(request("/x", number));
    expect(error.code).toBe("unexpected");
    expect(error.message).not.toContain("do-not-show");
  });

  test("a call that the caller cancelled is not reported as a network failure", async () => {
    const controller = new AbortController();
    stub(() => {
      controller.abort();
      return Promise.reject(new DOMException("aborted", "AbortError"));
    });
    await expect(request("/x", number, { signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
  });
});
