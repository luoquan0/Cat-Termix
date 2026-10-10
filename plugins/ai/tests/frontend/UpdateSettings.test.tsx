import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { UpdateSettings } from "../../src/frontend/UpdateSettings";
import type { UpdateInfo } from "../../src/shared/update-policy";

const api = vi.hoisted(() => ({
  get: vi.fn(),
  put: vi.fn(),
  post: vi.fn(),
}));

vi.mock("../../src/frontend/app-ref", () => ({
  aiApp: () => ({ api }),
}));
vi.mock("react-i18next", async (original) => ({
  ...(await original<object>()),
  useTranslation: () => ({ t: (key: string) => key }),
}));

const requestId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
let snapshot: UpdateInfo;
beforeEach(() => {
  vi.clearAllMocks();
  snapshot = {
    canManage: true,
    installed: true,
    policy: { enabled: false, intervalHours: 6, proxyUrl: "" },
    proxyConfigured: false,
    status: {
      phase: "current",
      lastCheckAt: "2026-10-09T01:00:00.000Z",
      currentRevision: "a".repeat(40),
      availableRevision: "a".repeat(40),
    },
    request: null,
  };
  api.get.mockImplementation(async () => ({ data: structuredClone(snapshot) }));
  api.put.mockResolvedValue({ data: { success: true } });
  api.post.mockImplementation(async () => {
    snapshot = {
      ...snapshot,
      request: {
        id: requestId,
        action: "check",
        requestedAt: "2026-10-10T00:00:00.000Z",
        state: "queued",
      },
    };
    return { data: { accepted: true, requestId } };
  });
});
afterEach(cleanup);

async function showSettings() {
  render(<UpdateSettings />);
  await screen.findByText("ai.updateLatest");
  fireEvent.click(screen.getByText("ai.updateSettings"));
}

describe("updater check feedback", () => {
  it("spins immediately and keeps spinning after HTTP 202 until the helper finishes", async () => {
    await showSettings();
    const check = screen.getByRole("button", { name: "ai.updateCheck" });
    fireEvent.click(check);
    await screen.findByText("ai.updateQueued");
    const checking = screen.getByRole("button", { name: "ai.updateChecking" });
    expect((checking as HTMLButtonElement).disabled).toBe(true);
    expect(checking.querySelector(".animate-spin")).not.toBeNull();
    expect(screen.getByTestId("updater-progress").textContent).toContain(
      "ai.updateQueued",
    );
    expect(api.post).toHaveBeenCalledWith("/updates/check", {
      confirmRestart: false,
    });

    snapshot = {
      ...snapshot,
      request: { ...snapshot.request!, state: "running" },
      status: { ...snapshot.status, phase: "checking" },
    };
    await waitFor(
      () =>
        expect(screen.getByTestId("updater-progress").textContent).toContain(
          "ai.updateCheckingUpstream",
        ),
      { timeout: 5000 },
    );
    snapshot = {
      ...snapshot,
      request: { ...snapshot.request!, state: "completed" },
      status: {
        ...snapshot.status,
        phase: "current",
        lastCheckAt: "2026-10-10T00:00:05.000Z",
      },
    };
    await waitFor(
      () =>
        expect(screen.getByTestId("updater-progress").textContent).toContain(
          "ai.updateLatest",
        ),
      { timeout: 5000 },
    );
    expect(
      (
        screen.getByRole("button", {
          name: "ai.updateCheck",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false);
  }, 15000);

  it("shows updater errors and their message without a misleading completion", async () => {
    snapshot.request = {
      id: requestId,
      action: "check",
      requestedAt: "2026-10-10T00:00:00.000Z",
      state: "failed",
    };
    snapshot.status = {
      ...snapshot.status,
      phase: "error",
      message: "Registry request failed (502); check proxy",
    };
    render(<UpdateSettings />);
    await screen.findByText("ai.updateCheckFailed");
    expect(screen.getByTestId("updater-progress").textContent).toContain(
      "Registry request failed (502)",
    );
    expect(screen.getByTestId("updater-progress").textContent).not.toContain(
      "ai.updateLatest",
    );
  });

  it("does not expose updater controls to an account without admin grants", async () => {
    snapshot.canManage = false;
    render(<UpdateSettings />);
    await waitFor(() => expect(api.get).toHaveBeenCalled());
    expect(screen.queryByTestId("system-software-updates")).toBeNull();
  });
});
