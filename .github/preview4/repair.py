from pathlib import Path
import json

def replace(name, before, after, count=1):
    p = Path(name)
    text = p.read_text()
    assert text.count(before) == count, 'Unexpected source: ' + name
    p.write_text(text.replace(before, after))

replace('plugins/ai/tests/backend/engine.test.ts',
    '    expect(events).toHaveLength(1);\n    expect(events[0]).toMatchObject({\n      type: "error",',
    '    const errors = events.filter((event) => event.type !== "context");\n    expect(errors).toHaveLength(1);\n    expect(errors[0]).toMatchObject({\n      type: "error",')
replace('plugins/ai/tests/backend/engine.test.ts',
    'streamChat.mockImplementationOnce(async function* () { throw new Error("context_length_exceeded"); })',
    'streamChat.mockImplementationOnce(() => { throw new Error("context_length_exceeded"); })')
replace('plugins/ai/tests/backend/permissions.test.ts',
    '  "ai.secrets.share",\n', '  "ai.secrets.share",\n  "ai.manage_updates",\n')
replace('plugins/ai/tests/backend/permissions.test.ts',
    'expect(permission.defaultRoles).toEqual(["user"]);',
    'expect(permission.defaultRoles).toEqual(permission.name === "manage_updates" ? ["admin"] : ["user"]);')
replace('plugins/ai/tests/backend/permissions.test.ts',
    'registers exactly the ids roles already hold', 'retains existing ids and adds a distinct administrator-only update permission')
replace('plugins/ai/src/frontend/AiProviderSettings.tsx', 'z-[200]', 'z-[300]', 3)
replace('plugins/ai/src/frontend/ContextControls.tsx',
    'Math.min(next.outputReserve, next.contextWindow / 2)',
    'Math.min(next.outputReserve, Math.floor(next.contextWindow / 2))')
replace('plugins/ai/src/frontend/ContextControls.tsx',
    'Math.min(65536, value.contextWindow / 2)',
    'Math.min(65536, Math.floor(value.contextWindow / 2))')

p = Path('/tmp/cat-ai-prepared4/paths.json')
if p.exists():
    paths = json.loads(p.read_text())
    for name in ['plugins/ai/tests/backend/permissions.test.ts', 'plugins/ai/src/frontend/AiProviderSettings.tsx']:
        if name not in paths: paths.append(name)
    p.write_text(json.dumps(paths))
