from pathlib import Path

def replace(path, old, new, count=1):
    file = Path(path)
    text = file.read_text()
    assert text.count(old) == count, (path, text.count(old), old)
    file.write_text(text.replace(old, new))

replace('plugins/agent/src/backend/index.ts', '  type AgentScope,\n', '')
replace('plugins/agent/tests/backend/operations.test.ts', 'import type { PluginContext }', 'import type { PluginContext, PluginHostSummary }')
replace('plugins/agent/tests/backend/operations.test.ts', '    const hosts = [\n      { id: 42, userId: DEVICE.ownerId, folder: "lab", name: "old" },\n    ];\n    f.ctx.hosts.list = vi.fn(async () => hosts) as typeof f.ctx.hosts.list;', '    const hosts: PluginHostSummary[] = [\n      { id: 42, userId: DEVICE.ownerId, folder: "lab", name: "old", ip: "10.0.0.42", port: 22, username: "root", tags: "", authType: "password" },\n    ];\n    f.ctx.hosts.list = vi.fn(async () => hosts);')
replace('plugins/agent/tests/backend/operations.test.ts', '      { id: 43, userId: DEVICE.ownerId, folder: "lab", name: "new" },\n      { id: 44, userId: DEVICE.ownerId, folder: "other", name: "outside" },\n      { id: 45, userId: "another-user", folder: "lab", name: "private" },', '      { ...hosts[0], id: 43, name: "new" },\n      { ...hosts[0], id: 44, folder: "other", name: "outside" },\n      { ...hosts[0], id: 45, userId: "another-user", name: "private" },')
replace('plugins/agent/tests/backend/grants.test.ts', '{ "x-no-session": "1" })).status).toBe(403);', '{ "x-no-session": "1" })).status).toBe(401);')
replace('plugins/ai/tests/frontend/AiComposerControls.test.tsx', 'import { afterEach, expect, it, vi }', 'import { afterAll, afterEach, beforeAll, expect, it, vi }')
replace('plugins/ai/tests/frontend/AiComposerControls.test.tsx', 'afterEach(() => { cleanup(); vi.clearAllMocks(); });', '''// Radix scrolls the focused menu item. jsdom does not implement layout scrolling.
const originalScroll = Object.getOwnPropertyDescriptor(Element.prototype, "scrollIntoView");
beforeAll(() => Object.defineProperty(Element.prototype, "scrollIntoView", { configurable: true, value: vi.fn() }));
afterAll(() => {
  if (originalScroll) Object.defineProperty(Element.prototype, "scrollIntoView", originalScroll);
  else Reflect.deleteProperty(Element.prototype, "scrollIntoView");
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });''')
