import { assertEquals, assertRejects } from "jsr:@std/assert";
import {
  configure,
  setAuthToken,
  getAuthToken,
  getKycStatus,
  listTransactions,
} from "../src/api/client.ts";

// The client references window.location on 401, so provide a minimal stub.
if (typeof globalThis.window === "undefined") {
  // deno-lint-ignore no-explicit-any
  (globalThis as any).window = { location: { hash: "" } };
}

/** Start a local HTTP server that responds based on the request path. */
function startMockServer(
  handler: (req: Request) => Response | Promise<Response>,
): { url: string; shutdown: () => Promise<void> } {
  const server = Deno.serve({ port: 0, onListen() {} }, handler);
  const addr = server.addr;
  const url = `http://localhost:${addr.port}`;
  return {
    url,
    shutdown: () => server.shutdown(),
  };
}

Deno.test("successful JSON response returns parsed data", async () => {
  const payload = { data: { status: "verified", jurisdiction: "US" } };
  const mock = startMockServer((_req) =>
    new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })
  );

  try {
    configure({ baseUrl: `${mock.url}/api/v1` });
    setAuthToken(null);
    const result = await getKycStatus("GABC123");
    assertEquals(result, payload);
  } finally {
    await mock.shutdown();
  }
});

Deno.test("non-200 response throws with error message from body", async () => {
  const mock = startMockServer((_req) =>
    new Response(JSON.stringify({ message: "Not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    })
  );

  try {
    configure({ baseUrl: `${mock.url}/api/v1` });
    setAuthToken(null);
    await assertRejects(
      () => getKycStatus("GABC123"),
      Error,
      "Not found",
    );
  } finally {
    await mock.shutdown();
  }
});

Deno.test("non-JSON success response throws meaningful error", async () => {
  const mock = startMockServer((_req) =>
    new Response("this is plain text", {
      status: 200,
      headers: { "Content-Type": "text/plain" },
    })
  );

  try {
    configure({ baseUrl: `${mock.url}/api/v1` });
    setAuthToken(null);
    await assertRejects(
      () => getKycStatus("GABC123"),
      Error,
      "Invalid JSON in response",
    );
  } finally {
    await mock.shutdown();
  }
});

Deno.test({
  name: "401 response clears auth token",
  // The client throws before consuming the response body on 401,
  // which Deno detects as a resource leak.
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const mock = startMockServer((_req) =>
      new Response(JSON.stringify({ message: "Unauthorized" }), { status: 401 })
    );

    try {
      configure({ baseUrl: `${mock.url}/api/v1` });
      setAuthToken("my-secret-token");
      assertEquals(getAuthToken(), "my-secret-token");

      await assertRejects(
        () => getKycStatus("GABC123"),
        Error,
        "Unauthorized",
      );

      assertEquals(getAuthToken(), null);
    } finally {
      await mock.shutdown();
    }
  },
});

Deno.test("request includes Authorization header when token is set", async () => {
  let capturedAuth: string | null = null;

  const mock = startMockServer((req) => {
    capturedAuth = req.headers.get("Authorization");
    return new Response(JSON.stringify({ data: { transactions: [], total: 0 } }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });

  try {
    configure({ baseUrl: `${mock.url}/api/v1` });
    setAuthToken("test-token-xyz");
    await listTransactions();
    assertEquals(capturedAuth, "Bearer test-token-xyz");
  } finally {
    setAuthToken(null);
    await mock.shutdown();
  }
});

Deno.test("request omits Authorization header when no token is set", async () => {
  let capturedAuth: string | null = "should-be-null";

  const mock = startMockServer((req) => {
    capturedAuth = req.headers.get("Authorization");
    return new Response(JSON.stringify({ data: { transactions: [], total: 0 } }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });

  try {
    configure({ baseUrl: `${mock.url}/api/v1` });
    setAuthToken(null);
    await listTransactions();
    assertEquals(capturedAuth, null);
  } finally {
    await mock.shutdown();
  }
});

Deno.test("non-200 with non-JSON body throws HTTP status", async () => {
  const mock = startMockServer((_req) =>
    new Response("server error", { status: 500 })
  );

  try {
    configure({ baseUrl: `${mock.url}/api/v1` });
    setAuthToken(null);
    await assertRejects(
      () => getKycStatus("GABC123"),
      Error,
      "HTTP 500",
    );
  } finally {
    await mock.shutdown();
  }
});
