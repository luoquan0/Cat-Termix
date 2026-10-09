from pathlib import Path
import json
root=Path.cwd()
def edit(path, old, new, count=1):
 p=root/path;s=p.read_text();assert s.count(old)==count,(path,s.count(old),old[:100]);p.write_text(s.replace(old,new))
p='plugins/ai/src/frontend/AiSessionControls.tsx'
edit(p,'export type ApprovalMode = "review" | "auto";', 'export type ApprovalMode = "review" | "auto";\nexport type ExecutionMode = "isolated" | "shared";')
edit(p,'  disabled: boolean;\n}', '''  disabled: boolean;
  executionMode?: ExecutionMode;
  onExecutionModeChange?: (mode: ExecutionMode) => void;
}''')
edit(p,'  disabled,\n}: Props)', '  disabled,\n  executionMode = "isolated",\n  onExecutionModeChange,\n}: Props)')
edit(p,'      {modelError && (','''      {onExecutionModeChange && (
        <div className="space-y-1">
          <Select value={executionMode} disabled={disabled}
            onValueChange={(value) => onExecutionModeChange(value as ExecutionMode)}>
            <SelectTrigger className="h-8 w-full text-xs" aria-label={t("ai.executionMode")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="z-[200]">
              <SelectItem value="isolated">{t("ai.executionIsolated")}</SelectItem>
              <SelectItem value="shared">{t("ai.executionShared")}</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-[11px] text-muted-foreground">
            {t(executionMode === "shared" ? "ai.sharedExecutionHint" : "ai.isolatedExecutionHint")}
          </p>
        </div>
      )}
      {modelError && (''')
p='plugins/ai/src/frontend/AiPanel.tsx'
edit(p,'import { AiSessionControls, type ApprovalMode } from "./AiSessionControls";', '''import { AiSessionControls, type ApprovalMode, type ExecutionMode } from "./AiSessionControls";
import { useChatScroll } from "./use-chat-scroll";''')
edit(p,'  getTerminalContext?: () => string;','  getTerminalContext?: () => string;\n  getTerminalSessionId?: () => string | null;')
edit(p,'  getTerminalContext,\n  onRunInTerminal,','  getTerminalContext,\n  getTerminalSessionId,')
edit(p,'  const [approvalMode, setApprovalMode] = useState<ApprovalMode>("review");','''  const [approvalMode, setApprovalMode] = useState<ApprovalMode>("review");
  const [executionMode, setExecutionMode] = useState<ExecutionMode>("isolated");
  const [executingProposalId, setExecutingProposalId] = useState<number | null>(null);''')
edit(p,'  const scrollRef = useRef<HTMLDivElement>(null);','''  const chatScroll = useChatScroll(!loading);
  const { jumpToLatest } = chatScroll;
  const executing = state.streaming || executingProposalId !== null;''')
edit(p,'''  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [state.assistantText, state.tools.length, history.length]);
''','')
edit(p,'''    setInput("");
    setHistory((prev) => [...prev, userEntry(message)]);''','''    jumpToLatest();
    setInput("");
    setHistory((prev) => [...prev, userEntry(message)]);''')
edit(p,'''      approvalMode,
      hostId,''','''      approvalMode,
      executionMode,
      terminalSessionId: getTerminalSessionId?.(),
      hostId,''',2)
edit(p,'''    approvalMode,
    hostId,
    activeTab,''','''    approvalMode,
    executionMode,
    getTerminalSessionId,
    hostId,
    activeTab,''')
edit(p,'''  ) {
    setResolvedProposals((prev) => ({''','''  ) {
    jumpToLatest();
    setResolvedProposals((prev) => ({''')
edit(p,'''            {t("ai.collaborativeTerminal", {''','''            {t("ai.boundTerminal", {''')
edit(p,'''            disabled={state.streaming}
          />''','''            disabled={executing}
            executionMode={executionMode}
            onExecutionModeChange={getTerminalSessionId ? (mode) => {
              setExecutionMode(mode);
              jumpToLatest();
            } : undefined}
          />''')
edit(p,'''        ref={scrollRef}
        className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3"''','''        ref={chatScroll.viewportRef}
        onScroll={chatScroll.onScroll}
        onWheel={chatScroll.onWheel}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3"
        style={{ overflowAnchor: "none" }}''')
edit(p,'''      >
        {timeline.length === 0 && (''','''      >
        <div ref={chatScroll.contentRef} className="space-y-3">
        {timeline.length === 0 && (''')
edit(p,'''              hostId={hostId}
              onRunInTerminal={onRunInTerminal}''','''              executionMode={executionMode}
              getTerminalSessionId={getTerminalSessionId}
              onExecuting={(active) => setExecutingProposalId(active ? item.proposal.id : null)}
              disabled={executingProposalId !== null && executingProposalId !== item.proposal.id}''')
edit(p,'''        )}
      </div>

      <div className="relative border-t border-border p-3">''','''        )}
        </div>
      </div>
      {!chatScroll.following && (
        <Button type="button" size="sm" variant="secondary" className="mx-auto my-1 shrink-0"
          onClick={jumpToLatest}>{t("ai.jumpToLatest")}</Button>
      )}

      <div className="relative shrink-0 border-t border-border p-3">''')
edit(p,'''          {getTerminalContext && (''','''          {getTerminalContext && executionMode === "isolated" && (''')
s=(root/p).read_text().replace('disabled={state.streaming}', 'disabled={executing}').replace('disabled={state.streaming || loadingConversationId !== null}', 'disabled={executing || loadingConversationId !== null}')
s=s.replace('      state.streaming ||\n      loadingConversationId', '      executing ||\n      loadingConversationId')
s=s.replace('disabled={!input.trim() || !providerId || !model.trim()}', 'disabled={executing || !input.trim() || !providerId || !model.trim()}')
(root/p).write_text(s)
p='plugins/ai/src/frontend/ProposalCard.tsx'
s=(root/p).read_text();s=s.replace('import { useState }','import { useEffect, useState }')
s=s.replace('Check, Loader2, Terminal, TriangleAlert, X','Check, ChevronDown, ChevronRight, Loader2, TriangleAlert, X')
s=s.replace('  claimAiProposalRunInTerminal,\n','').replace('  markAiProposalRunInTerminal,\n','')
s=s.replace('  hostId?: number;\n  onRunInTerminal?: (command: string) => boolean;', '''  executionMode?: "isolated" | "shared";
  getTerminalSessionId?: () => string | null;
  onExecuting?: (active: boolean) => void;
  disabled?: boolean;''')
s=s.replace('  hostId,\n  onRunInTerminal,','''  executionMode = "isolated",
  getTerminalSessionId,
  onExecuting,
  disabled = false,''')
start=s.index('  const [busy, setBusy]');end=s.index('\n\n  let payload:',start)
s=s[:start]+'''  const [busy, setBusy] = useState<"apply" | "reject" | null>(null);
  const [expanded, setExpanded] = useState(proposal.status === "pending");
  useEffect(() => { setExpanded(proposal.status === "pending"); }, [proposal.status]);'''+s[end:]
s=s.replace('''    setBusy("apply");
    try {
      const result = await applyAiProposal(proposal.id);''','''    setBusy("apply");
    onExecuting?.(true);
    try {
      const result = await applyAiProposal(proposal.id, {
        executionMode,
        terminalSessionId: getTerminalSessionId?.(),
      });''')
s=s.replace('''    } finally {
      setBusy(null);
    }
  }

  async function handleSubmitToTerminal''','''    } finally {
      setBusy(null);
      onExecuting?.(false);
    }
  }

  async function handleSubmitToTerminal''')
start=s.index('  async function handleSubmitToTerminal');end=s.index('  async function handleReject',start);s=s[:start]+s[end:]
s=s.replace('''      <div className="flex items-center gap-1.5">''','''      <button type="button" className="flex w-full items-center gap-1.5 text-left"
        aria-expanded={expanded} onClick={() => setExpanded((open) => !open)}>
        {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}''',1)
s=s.replace('''      </div>

      {/*
        A command''','''      </button>
      {expanded && <div>
      {/*
        A command''',1)
start=s.index('      {!resolved && confirmTerminal');end=s.index('      {!resolved && (',start+15);s=s[:start]+s[end:]
start=s.index('          {command && hostId && onRunInTerminal');end=s.index('          <Button', s.index('          )}',start)+12);s=s[:start]+s[end:]
s=s.replace('busy !== null || submittedLocally','busy !== null || disabled')
s=s.replace('''      )}
    </div>
  );''','''      )}
      </div>}
    </div>
  );''')
(root/p).write_text(s)
p='plugins/ai/src/frontend/transcript.ts'
s=(root/p).read_text();start=s.index('  for (const proposal of proposals) {');end=s.index('\n  return timeline;', start)
s=s[:start]+'''  const remaining = new Map(proposals.map((proposal) => [proposal.id, proposal]));
  const ordered: TimelineItem[] = [];
  for (const item of timeline) {
    ordered.push(item);
    if (item.kind !== "tool") continue;
    const result = item.tool.result as { proposalId?: number } | undefined;
    const proposal = [...remaining.values()].find((candidate) => {
      if (candidate.id === item.tool.proposalId || candidate.id === result?.proposalId) return true;
      if (candidate.kind !== item.tool.name) return false;
      try {
        const payload = JSON.parse(candidate.payload) as Record<string, unknown>;
        return Object.entries(item.tool.arguments).every(([key, value]) =>
          JSON.stringify(payload[key]) === JSON.stringify(value));
      } catch { return false; }
    });
    if (proposal) {
      ordered.push({ kind: "proposal", key: `proposal-${proposal.id}`, proposal });
      remaining.delete(proposal.id);
    }
  }
  // Legacy rows may lack tool linkage. Still keep them above the latest answer.
  const lastReply = ordered.findLastIndex((item) => item.kind === "message" && item.role === "assistant");
  ordered.splice(lastReply < 0 ? ordered.length : lastReply, 0,
    ...[...remaining.values()].map((proposal): TimelineItem => ({
      kind: "proposal", key: `proposal-${proposal.id}`, proposal,
    })),
  );
''' + s[end:];s=s.replace('  return timeline;','  return ordered;');(root/p).write_text(s)
p='plugins/ai/src/frontend/use-ai-stream.ts'
edit(p,'  result?: unknown;','  result?: unknown;\n  proposalId?: number;')
edit(p,'''            } else if (event.type === "proposal") {
              setState((prev) => ({
                ...prev,
                proposals: [...prev.proposals, event.proposal],
              }));''','''            } else if (event.type === "proposal") {
              const index = runTools.findLastIndex((tool) =>
                tool.name === event.proposal.kind && tool.proposalId === undefined);
              const id = index < 0 ? null : runTools[index].id;
              if (index >= 0) runTools[index] = { ...runTools[index], proposalId: event.proposal.id };
              setState((prev) => ({
                ...prev,
                tools: prev.tools.map((tool) => tool.id === id ? { ...tool, proposalId: event.proposal.id } : tool),
                proposals: [...prev.proposals, event.proposal],
              }));''')
for lang,vals,terminal in [
 ('en',{'executionMode':'Command execution mode','executionIsolated':'Isolated execution (chat only)','executionShared':'Shared SSH terminal (visible commands + output)','boundTerminal':'Current host: {{host}}','sharedExecutionHint':'Commands and output appear in this SSH terminal and results return automatically. Use an idle Bash/zsh prompt. Ctrl+C takes over. AI scripts inherit cwd/environment but cannot change the parent shell state.','isolatedExecutionHint':'Separate SSH exec channel; commands do not appear in the manual terminal.','jumpToLatest':'Jump to latest reply'},'AI is using this terminal. Ctrl+C interrupts and returns control.'),
 ('translated/zh_CN',{'executionMode':'命令执行模式','executionIsolated':'独立执行（仅聊天内显示）','executionShared':'共用当前 SSH 终端（显示指令与输出）','boundTerminal':'当前主机：{{host}}','sharedExecutionHint':'指令和输出显示在左侧 SSH，结果自动交回 AI。需处于空闲 Bash/zsh 提示符；执行中按 Ctrl+C 接管。AI 脚本继承当前目录和环境，但不改变父 Shell 状态。','isolatedExecutionHint':'使用独立 SSH 执行通道，不向左侧手动终端写入指令。','jumpToLatest':'查看最新回复'},'AI 正在使用此终端，按 Ctrl+C 中断并接管。')]:
 p=root/f'plugins/ai/locales/{lang}.json';o=json.loads(p.read_text());o['ai'].update(vals);p.write_text(json.dumps(o,ensure_ascii=False,indent=2)+'\n')
 p=root/f'plugins/ssh-terminal/locales/{lang}.json';o=json.loads(p.read_text());o['terminalToolbar']['aiCommandActive']=terminal;p.write_text(json.dumps(o,ensure_ascii=False,indent=2)+'\n')
