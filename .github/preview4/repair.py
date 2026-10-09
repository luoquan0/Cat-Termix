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

gate = '      if (await maintenance(ctx)) return res.status(503).json({ error: "Application update in progress. Retry after restart." });\n'
replace('plugins/ai/src/backend/routes.ts', gate, '', 2)
replace('plugins/ai/src/backend/routes.ts',
    '      activeAiRequests.add(activeRequest);\n      try {\n',
    '      activeAiRequests.add(activeRequest);\n      try {\n' + gate)
replace('plugins/ai/src/backend/routes.ts',
    '      const activeRequest = Symbol("proposal"); activeAiRequests.add(activeRequest);\n      try {\n',
    '      const activeRequest = Symbol("proposal"); activeAiRequests.add(activeRequest);\n      try {\n' + gate)

p = Path('plugins/ai/tests/backend/update-settings.test.ts')
s = p.read_text().replace('afterEach, describe, expect, it', 'afterEach, describe, expect, it, vi')
s = 'import { mkdtemp, rm, readFile } from "node:fs/promises";\nimport os from "node:os";\nimport path from "node:path";\n' + s
s = s.replace('let server: TestServer;', 'let server: TestServer;\nlet directory: string | undefined;')
s = s.replace('await server?.close();', 'await server?.close(); if (directory) await rm(directory, {recursive:true,force:true}); directory = undefined; vi.restoreAllMocks();')
s += '''
describe("authorized updater policy storage", () => {
  it("saves a proxy without reflecting credentials, retains it and requires explicit restart consent", async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), "cat-update-settings-"));
    server = await startServer({ permissions: ["ai.manage_updates", "admin.settings.manage"] });
    vi.spyOn(server.mock.ctx.files, "dataDir").mockResolvedValue(directory);
    const policy = { enabled:false, intervalHours:6, proxyUrl:"http://tester:password@localhost:7890" };
    expect((await server.request("PUT", "/updates", {body:policy})).status).toBe(200);
    const loaded = await server.request("GET", "/updates");
    expect(loaded.body).toMatchObject({canManage:true,installed:false,proxyConfigured:true,policy:{proxyUrl:"http://localhost:7890"}});
    expect(JSON.stringify(loaded.body)).not.toContain("password");
    expect((await server.request("PUT", "/updates", {body:{...policy,proxyUrl:"",keepProxy:true}})).status).toBe(200);
    expect(JSON.parse(await readFile(path.join(directory,"updates","config.json"),"utf8")).proxyUrl).toBe(policy.proxyUrl);
    expect((await server.request("POST", "/updates/apply", {body:{}})).status).toBe(400);
    expect((await server.request("POST", "/updates/apply", {body:{confirmRestart:true}})).status).toBe(202);
    expect(JSON.parse(await readFile(path.join(directory,"updates","request.json"),"utf8")).action).toBe("apply");
  });
});
'''
p.write_text(s)

p = Path('docker/updater/smoke.mjs')
s = p.read_text().replace("import { randomUUID } from 'node:crypto';", "import { randomUUID, createHash } from 'node:crypto';\nimport { gzipSync } from 'node:zlib';\nimport * as tar from 'tar';")
s = s.replace('Docker, replaceContainer, IMAGE, SOURCE', 'Docker, Registry, replaceContainer, IMAGE, SOURCE')
s = s.replace("const label='io.cat-termix.updater-test='+id;", "const label='io.cat-termix.updater-test='+id;\nlet fixtureImage;")
block = '''
  // Exercise verified OCI download -> Docker load with a minimal, local fixture.
  // All registry requests use the same proxy dispatcher, including layer bytes.
  await fs.writeFile(path.join(temp,'proof'),'verified image layer');
  await tar.c({cwd:temp,file:path.join(temp,'fixture-layer.tar'),portable:true},['proof']);
  const layerBytes=await fs.readFile(path.join(temp,'fixture-layer.tar'));
  const compressed=gzipSync(layerBytes);
  const digest=(bytes)=>'sha256:'+createHash('sha256').update(bytes).digest('hex');
  const revision='f'.repeat(32)+id;
  const configBytes=Buffer.from(JSON.stringify({architecture:image.Architecture,os:'linux',
    config:{Labels:{'org.opencontainers.image.source':SOURCE,'org.opencontainers.image.revision':revision}},
    rootfs:{type:'layers',diff_ids:[digest(layerBytes)]},history:[{created_by:'Cat-Termix CI fixture'}]}));
  const manifest={schemaVersion:2,mediaType:'application/vnd.oci.image.manifest.v1+json',
    config:{mediaType:'application/vnd.oci.image.config.v1+json',digest:digest(configBytes),size:configBytes.length},
    layers:[{mediaType:'application/vnd.oci.image.layer.v1.tar+gzip',digest:digest(compressed),size:compressed.length}]};
  const calls=[], dispatcher={testProxy:true};
  const registry=new Registry(async(url,options)=>{
    calls.push({url,options});
    if(url.includes('/token?'))return Response.json({token:'fixture'});
    if(url.endsWith('/manifests/ai-dev'))return Response.json(manifest);
    if(url.endsWith('/blobs/'+digest(configBytes)))return new Response(configBytes);
    if(url.endsWith('/blobs/'+digest(compressed)))return new Response(compressed);
    throw new Error('Unexpected fixture registry request');
  },dispatcher);
  const downloaded=await registry.release(image.Architecture);
  fixtureImage=digest(configBytes);
  await registry.load(downloaded,docker,stateDir);
  const imported=await docker.call('GET',`/images/${encodeURIComponent(downloaded.imageRef)}/json`);
  assert.equal(imported.Id,fixtureImage);
  assert.deepEqual(imported.RootFS.Layers,[digest(layerBytes)]);
  assert.ok(calls.length>=4 && calls.every(c=>c.options.dispatcher===dispatcher));
  console.log('Verified OCI layer download and real Docker import through proxy-aware transport: passed');
'''
s = s.replace("  console.log('Docker replacement", block + "\n  console.log('Docker replacement", 1)
s = s.replace('} finally {\n  const filters=', "} finally {\n  if(fixtureImage) await docker.call('DELETE',`/images/${fixtureImage}?force=1`).catch(()=>{});\n  const filters=", 1)
p.write_text(s)

p = Path('plugins/ai/src/frontend/use-ai-stream.ts')
s=p.read_text()
a='    setState((prev) => ({ ...prev, streaming: false }));'
b='''    setState((prev) => ({ ...prev, streaming: false,
      contextUsage: prev.contextUsage?.state === "compacting" ? { ...prev.contextUsage, state: "ready" } : prev.contextUsage,
    }));'''
assert s.count(a)==1
s=s.replace(a,b)
a='''          streaming: false,
          assistantText: "",'''
b='''          streaming: false,
          contextUsage: prev.contextUsage?.state === "compacting" ? { ...prev.contextUsage, state: error ? "error" : "ready" } : prev.contextUsage,
          assistantText: "",'''
assert s.count(a)==1
p.write_text(s.replace(a,b))
p=Path('plugins/ai/tests/frontend/use-ai-stream.test.tsx')
s=p.read_text()+'''
it("settles context compression when the response is stopped", () => {
  const { result } = renderHook(useAiStream);
  act(() => result.current.setState((old) => ({ ...old, streaming:true, contextUsage:{
    inputTokens:24000,contextWindow:32768,outputReserve:4096,percent:86,
    estimated:true,compactions:0,state:"compacting",
  }})));
  act(() => result.current.stop());
  expect(result.current.state.streaming).toBe(false);
  expect(result.current.state.contextUsage?.state).toBe("ready");
  expect(result.current.state.contextUsage?.inputTokens).toBe(24000);
});
'''
p.write_text(s)
p=Path('/tmp/cat-ai-prepared4/paths.json')
if p.exists():
    names=json.loads(p.read_text())
    name='plugins/ai/tests/frontend/use-ai-stream.test.tsx'
    if name not in names:names.append(name)
    p.write_text(json.dumps(names))
