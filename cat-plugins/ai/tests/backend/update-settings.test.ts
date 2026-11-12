import { afterEach, describe, expect, it } from "vitest";
import { startServer, type TestServer } from "./helpers";

let server: TestServer | null = null;

afterEach(async () => {
  await server?.close();
  server = null;
});

describe("legacy updater is not exposed from AI in the v26 beta", () => {
  for (const permissions of [[], ["ai.manage_updates", "admin.settings.manage"]]) {
    it(`denies updater endpoints even for ${permissions.length ? "old admins" : "regular users"}`, async () => {
      server = await startServer({ permissions });
      for (const [method, path] of [
        ["GET", "/updates"],
        ["PUT", "/updates"],
        ["POST", "/updates/check"],
        ["POST", "/updates/apply"],
      ] as const) {
        const result = await server.request(method, path, {
          body: method === "GET" ? undefined : { enabled: true, confirmRestart: true },
        });
        expect(result.status).toBe(404);
      }
    });
  }
});
