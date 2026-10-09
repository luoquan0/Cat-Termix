from pathlib import Path
import json
root=Path.cwd()
def edit(path, old, new, count=1):
 p=root/path;s=p.read_text();n=s.count(old)
 assert n==count,(path,n,old[:120]);p.write_text(s.replace(old,new))
p='plugins/ssh-terminal/src/backend/session-manager.ts'
edit(p,'import { randomUUID } from "crypto";', 'import { randomUUID } from "crypto";\nimport { SharedTerminalRunner } from "./shared-terminal.js";')
edit(p,'export class TerminalSessionManager {','export class TerminalSessionManager {\n  readonly sharedCommands = new SharedTerminalRunner();')
edit(p,'  detachWs(sessionId: string): void {','  detachWs(sessionId: string): void {\n    this.sharedCommands.cancel(sessionId, "Terminal owner detached");')
edit(p,'  destroySession(sessionId: string): void {','  destroySession(sessionId: string): void {\n    this.sharedCommands.forget(sessionId);')
edit(p,'''  bufferInput(sessionId: string, data: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    this.recordSessionEvent(session, "i", data);
  }''','''  bufferInput(sessionId: string, data: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session || !this.sharedCommands.input(sessionId, data)) return false;
    this.recordSessionEvent(session, "i", data);
    return true;
  }''')
p='plugins/ssh-terminal/src/backend/terminal-socket.ts'
edit(p,'          sessionManager.bufferInput(currentSessionId, inputData);\n          const inputStream','          if (!sessionManager.bufferInput(currentSessionId, inputData)) break;\n          const inputStream')
edit(p,'''              if (currentSessionId) {
                sessionManager.bufferInput(currentSessionId, inputData);
              }''','''              if (currentSessionId && !sessionManager.bufferInput(currentSessionId, inputData)) break;''')
edit(p,'                  const utf8String = decoder.write(data);','''                  const utf8String = sessionManager.sharedCommands.filterOutput(
                    boundSessionId!, decoder.write(data),
                  );''')
edit(p,'                  const fallback = data.toString("latin1");','''                  const fallback = sessionManager.sharedCommands.filterOutput(
                    boundSessionId!, data.toString("latin1"),
                  );''')
p='plugins/ssh-terminal/src/backend/index.ts'
edit(p,'      sessionManager.bufferInput(sessionId, data);','      if (!sessionManager.bufferInput(sessionId, data)) return false;')
edit(p,'  const terminalHistory: TerminalHistoryV1 = {','''  ctx.services.provide("terminal.commands", {
    execute: async (input: {
      sessionId: string;
      hostId: number;
      command: string;
      signal?: AbortSignal;
    }) => {
      const userId = ctx.currentActor();
      const session = sessionManager.getSession(input.sessionId);
      if (
        !userId || !session || session.userId !== userId ||
        session.hostId !== input.hostId ||
        !sessionManager.getOwnerParticipant(session) ||
        !(await ctx.hosts.checkAccess(input.hostId, "connect")).hasAccess
      ) throw new Error("Shared terminal not found or not owned by this user");
      // Recheck attachment after the asynchronous access check.
      if (!sessionManager.getOwnerParticipant(session))
        throw new Error("The shared terminal was detached");
      return sessionManager.sharedCommands.execute(
        session, input.command, input.signal,
        (active) => sessionManager.broadcast(session.id, { type: "ai_command_state", active }),
      );
    },
  });

  const terminalHistory: TerminalHistoryV1 = {''')
p=root/'plugins/ssh-terminal/manifest.json';m=json.loads(p.read_text());m['provides'].append({'service':'terminal.commands','version':'1.0.0','permission':'ssh-terminal.sessions'});p.write_text(json.dumps(m,ensure_ascii=False,indent=2)+'\n')
p=root/'plugins/ai/manifest.json';m=json.loads(p.read_text());m['requires'].append({'service':'terminal.commands','versionRange':'^1.0.0','optional':True});p.write_text(json.dumps(m,ensure_ascii=False,indent=2)+'\n')
p='plugins/ai/src/backend/tools/types.ts'
edit(p,'  "hosts" | "services" | "notify" | "rbac" | "ssh" | "audit"\n>;','''  "hosts" | "services" | "notify" | "rbac" | "ssh" | "audit"
> & {
  runCommand?: (hostId: number, command: string, signal?: AbortSignal) =>
    Promise<{ output?: string; error?: string }>;
};''')
p='plugins/ai/src/backend/tools/executor.ts'
edit(p,'''    const result = await deps.ssh.withConnection<''','''    if (deps.runCommand) return await deps.runCommand(hostId, command, signal);
    const result = await deps.ssh.withConnection<''')
p='plugins/ai/src/backend/context.ts'
edit(p,'  hostId?: number;\n}): string {','  hostId?: number;\n  executionMode?: "isolated" | "shared";\n}): string {')
edit(p,'''    "- Commands use independent non-interactive SSH channels, so the user can keep working in their terminal. Shell state such as cd does not carry across commands: use explicit paths or combine dependent commands. Never assume access to the user's current shell input.",''','''    options.executionMode === "shared"
      ? "- Commands execute in the user's existing visible SSH PTY, and real output/exit status returns automatically. The server waits for an idle Bash/zsh prompt and reserves input until completion (Ctrl+C takes over). Commands inherit the current shell directory/environment, but run in a foreground subshell to protect the connection: cd/export changes do not persist to the parent shell. Use absolute paths or combine dependent commands. Use non-interactive commands. Do not ask the user to attach output that a command result already supplies."
      : "- Commands use independent non-interactive SSH channels, so the user can keep working in their terminal. Shell state such as cd does not carry across commands: use explicit paths or combine dependent commands. Never assume access to the user's current shell input.",''')
p='plugins/ai/src/backend/routes.ts'
edit(p,'  const logError = (message: string, error: unknown) =>','''  function executionDeps(
    mode: unknown,
    sessionId: unknown,
    hostId: number | undefined,
  ): ToolDeps {
    if (mode === undefined || mode === "isolated") return toolDeps;
    if (mode !== "shared" || !Number.isSafeInteger(hostId) || !hostId ||
        typeof sessionId !== "string" || !sessionId || sessionId.length > 200)
      throw new Error("Shared execution requires this host's active terminal session");
    const terminal = ctx.services.get<{
      execute(input: { sessionId: string; hostId: number; command: string; signal?: AbortSignal }):
        Promise<{ output: string; error?: string; code: number | null }>;
    }>("terminal.commands");
    if (!("execute" in terminal)) throw new Error("Shared terminal execution is unavailable");
    return {
      ...toolDeps,
      runCommand: async (target, command, signal) => {
        if (target !== hostId) throw new Error("Shared command targets another host");
        return terminal.execute({ sessionId, hostId, command, signal });
      },
    };
  }

  const logError = (message: string, error: unknown) =>''')
edit(p,'''        approvalMode = "review",
        resolvedProposalId,''','''        approvalMode = "review",
        executionMode = "isolated",
        terminalSessionId,
        resolvedProposalId,''')
edit(p,'''      if (approvalMode !== "review" && approvalMode !== "auto") {''','''      if (executionMode !== "isolated" && executionMode !== "shared") {
        return res.status(400).json({ error: "Invalid execution mode" });
      }
      if (approvalMode !== "review" && approvalMode !== "auto") {''')
edit(p,'''      try {
        if (
          approvalMode === "auto"''','''      try {
        const requestDeps = executionDeps(executionMode, terminalSessionId, hostId);
        if (
          approvalMode === "auto"''')
edit(p,'''              approvalMode,
              hostId,
            }),''','''              approvalMode,
              hostId,
              executionMode,
            }),''')
edit(p,'''              deps: toolDeps,
              hostId,''','''              deps: requestDeps,
              hostId,''')
edit(p,'''                        draft.payload,
                        toolDeps,
                        abort.signal,''','''                        draft.payload,
                        requestDeps,
                        abort.signal,''')
edit(p,'''        if (!(await repository.setProposalStatus(id, userId, "running"))) {''','''        const conversation = await repository.findConversation(stored.conversationId, userId);
        const requestDeps = executionDeps(
          req.body?.executionMode, req.body?.terminalSessionId,
          conversation?.hostId ?? undefined,
        );
        if (!(await repository.setProposalStatus(id, userId, "running"))) {''')
edit(p,'''          result = await applyProposal(stored.kind, payload, toolDeps);''','''          const abort = new AbortController();
          const onClose = () => { if (!res.writableFinished) abort.abort(); };
          res.on("close", onClose);
          try {
            result = await applyProposal(stored.kind, payload, requestDeps, abort.signal);
          } finally {
            res.removeListener("close", onClose);
          }''')
p='plugins/ai/src/frontend/use-ai-stream.ts'
edit(p,'      approvalMode?: "review" | "auto";','''      approvalMode?: "review" | "auto";
      executionMode?: "isolated" | "shared";
      terminalSessionId?: string | null;''')
edit(p,'''            approvalMode: input.approvalMode ?? "review",''','''            approvalMode: input.approvalMode ?? "review",
            executionMode: input.executionMode ?? "isolated",
            terminalSessionId: input.terminalSessionId ?? undefined,''')
p='plugins/ai/src/frontend/ai-api.ts'
edit(p,'''export async function applyAiProposal(
  id: number,
): Promise<{ success: boolean; summary: string }> {
  try {
    return (await api().post(`/proposals/${id}/apply`)).data;''','''export async function applyAiProposal(
  id: number,
  execution?: { executionMode: "isolated" | "shared"; terminalSessionId?: string | null },
): Promise<{ success: boolean; summary: string }> {
  try {
    return (await api().post(`/proposals/${id}/apply`, execution)).data;''')
for p in ['plugins/ai/src/frontend/terminal/terminal-slot-types.ts','plugins/ssh-terminal/src/frontend/terminal/terminal-slots.ts']:
 edit(p,'  getTerminalContext?: () => string;','  getTerminalContext?: () => string;\n  getTerminalSessionId?: () => string | null;')
p='plugins/ssh-terminal/src/frontend/terminal/Terminal.tsx'
edit(p,'    const [isConnected, setIsConnected] = useState(false);','''    const [isConnected, setIsConnected] = useState(false);
    const [aiCommandActive, setAiCommandActive] = useState(false);''')
edit(p,'''          } else if (msg.type === "data") {''','''          } else if (msg.type === "ai_command_state") {
            setAiCommandActive(Boolean(msg.active));
          } else if (msg.type === "data") {''')
edit(p,'''          } else if (msg.type === "disconnected") {''','''          } else if (msg.type === "disconnected") {
            setAiCommandActive(false);''')
edit(p,'''                getTerminalContext={() => getTerminalBufferText(terminal)}''','''                getTerminalContext={() => getTerminalBufferText(terminal)}
                getTerminalSessionId={() => sessionIdRef.current}''')
edit(p,'''        {isConnected && host && !showToolbar && (''','''        {isConnected && aiCommandActive && (
          <div role="status" className="absolute left-2 top-2 z-[110] border border-border bg-background/95 px-3 py-2 text-xs">
            {t("terminalToolbar.aiCommandActive")}
          </div>
        )}

        {isConnected && host && !showToolbar && (''')
p='plugins/ai/src/frontend/index.tsx'
edit(p,'''  getTerminalContext,
  onRunInTerminal,''','''  getTerminalContext,
  getTerminalSessionId,
  onRunInTerminal,''')
edit(p,'''      getTerminalContext={getTerminalContext}
      onRunInTerminal''','''      getTerminalContext={getTerminalContext}
      getTerminalSessionId={getTerminalSessionId}
      onRunInTerminal''')
p='plugins/ai/src/frontend/terminal/TerminalAiPanel.tsx'
edit(p,'  getTerminalContext?: () => string;','  getTerminalContext?: () => string;\n  getTerminalSessionId?: () => string | null;')
edit(p,'''  getTerminalContext,
  onRunInTerminal,''','''  getTerminalContext,
  getTerminalSessionId,
  onRunInTerminal,''')
edit(p,'''          getTerminalContext={getTerminalContext}
          onRunInTerminal''','''          getTerminalContext={getTerminalContext}
          getTerminalSessionId={getTerminalSessionId}
          onRunInTerminal''')
