import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "@termix/plugin-sdk/frontend";
import {
  History,
  Loader2,
  Plus,
  Trash2,
  Send,
  Settings2,
  Sparkles,
  Square,
} from "lucide-react";
import { Button, Textarea } from "@termix/plugin-sdk/ui";
import {
  deleteAiConversation,
  getAiConversation,
  getAiConversations,
  getAiProviders,
  getAiStatus,
  setAiOptIn,
  type AiConversation,
  type AiProposal,
  type AiProvider,
} from "./ai-api";
import { AiMessage } from "./AiMessage";
import { AiProviderSettings } from "./AiProviderSettings";
import { AiToolCall } from "./AiToolCall";
import { ProposalCard } from "./ProposalCard";
import {
  buildTimeline,
  finishedRunEntries,
  savedConversationEntries,
  userEntry,
  type HistoryEntry,
} from "./transcript";
import { useAiStream, type ToolActivity } from "./use-ai-stream";
import {
  activeMentionQuery,
  useMentions,
  type MentionItem,
} from "./useMentions";
import { mentionLabel } from "./labels";
import {
  AiSessionControls,
  type ApprovalMode,
  type ExecutionMode,
} from "./AiSessionControls";
import { useChatScroll } from "./use-chat-scroll";

interface AiPanelProps {
  activeTab?: string | null;
  hostId?: number;
  hostLabel?: string;
  terminalContext?: { hostId: number; tabInstanceId?: string };
  getTerminalSessionId?: () => string | null;
}

export function AiPanel({
  activeTab,
  hostId,
  hostLabel,
  terminalContext,
  getTerminalSessionId,
}: AiPanelProps) {
  const { t } = useTranslation();
  const { state, send, stop, reset, setState } = useAiStream();

  const [providers, setProviders] = useState<AiProvider[]>([]);
  const [providerId, setProviderId] = useState<number | null>(null);
  const [model, setModel] = useState("");
  const [approvalMode, setApprovalMode] = useState<ApprovalMode>("review");
  const [executionMode, setExecutionMode] = useState<ExecutionMode>("isolated");
  const [executingProposalId, setExecutingProposalId] = useState<number | null>(
    null,
  );
  const [pendingResolutions, setPendingResolutions] = useState<number[]>([]);
  const [setupError, setSetupError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showSettings, setShowSettings] = useState(false);
  const settingsId = useId();
  const [input, setInput] = useState("");
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [conversations, setConversations] = useState<AiConversation[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [loadingConversationId, setLoadingConversationId] = useState<
    number | null
  >(null);
  const [deletingConversationId, setDeletingConversationId] = useState<
    number | null
  >(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [resolvedProposals, setResolvedProposals] = useState<
    Record<
      number,
      {
        status: "applied" | "submitted" | "rejected" | "failed";
        resultSummary?: string;
      }
    >
  >({});
  const runCountRef = useRef(0);
  const historyOperationRef = useRef(0);
  const chatScroll = useChatScroll(!loading);
  const { jumpToLatest } = chatScroll;
  const executing = state.streaming || executingProposalId !== null;
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const [mention, setMention] = useState<{
    query: string;
    start: number;
  } | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  const { search: searchMentions } = useMentions(Boolean(providerId));

  const mentionMatches = mention ? searchMentions(mention.query) : [];

  function newConversation() {
    historyOperationRef.current += 1;
    reset();
    setHistory([]);
    setResolvedProposals({});
    setPendingResolutions([]);
    setApprovalMode("review");
    setExecutionMode("isolated");
    jumpToLatest();
    setInput("");
    setMention(null);
    setShowHistory(false);
    setShowSettings(false);
    setConfirmDeleteId(null);
    setLoadingConversationId(null);
    setHistoryError(null);
    runCountRef.current = 0;
  }

  const updateMentionQuery = (value: string, caret: number) => {
    const next = activeMentionQuery(value, caret);
    setMention(next);
    setMentionIndex(0);
  };

  /**
   * Replaces the "@partial" under the caret with the chosen name. The mention
   * is plain text: the assistant still has to call a read tool to look the
   * item up, so nothing is attached to the prompt behind the user's back.
   */
  const insertMention = (item: MentionItem) => {
    if (!mention) return;
    const caret = textareaRef.current?.selectionStart ?? input.length;
    const before = input.slice(0, mention.start);
    const after = input.slice(caret);
    const inserted = `@${item.label} `;

    setInput(`${before}${inserted}${after}`);
    setMention(null);

    requestAnimationFrame(() => {
      const position = before.length + inserted.length;
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(position, position);
    });
  };

  const loadProviders = useCallback(async (selectId?: number) => {
    try {
      const all = await getAiProviders();
      setProviders(all);
      const list = all.filter((item) => item.enabled);
      setProviderId((current) => {
        // A provider that was just added becomes the active one, so there is
        // no second step between creating it and being able to use it.
        if (selectId && list.some((entry) => entry.id === selectId)) {
          return selectId;
        }
        // Fall back to the first if the current selection has gone away.
        if (current && list.some((entry) => entry.id === current)) {
          return current;
        }
        return list[0]?.id ?? null;
      });
      return list;
    } catch {
      setProviders([]);
      return [];
    }
  }, []);

  const refreshConversations = useCallback(async () => {
    try {
      const records = await getAiConversations(hostId);
      setConversations(records);
      setHistoryError(null);
    } catch (error) {
      setHistoryError(
        error instanceof Error ? error.message : t("ai.historyLoadFailed"),
      );
    }
  }, [hostId, t]);

  const openConversation = async (id: number) => {
    if (executing || loadingConversationId !== null) return;
    const operation = ++historyOperationRef.current;
    setLoadingConversationId(id);
    setHistoryError(null);
    try {
      const saved = await getAiConversation(id);
      if (historyOperationRef.current !== operation) return;
      if ((saved.conversation.hostId ?? null) !== (hostId ?? null)) {
        throw new Error(t("ai.historyHostMismatch"));
      }
      reset();
      setHistory(savedConversationEntries(saved.messages));
      setResolvedProposals({});
      setPendingResolutions([]);
      setApprovalMode("review");
      setExecutionMode("isolated");
      jumpToLatest();
      setInput("");
      setMention(null);
      setConfirmDeleteId(null);
      runCountRef.current = saved.messages.length;
      if (
        saved.conversation.providerId &&
        providers.some(
          (item) => item.id === saved.conversation.providerId && item.enabled,
        )
      ) {
        setProviderId(saved.conversation.providerId);
        setModel(saved.conversation.model ?? "");
      }
      setState((prev) => ({
        ...prev,
        conversationId: saved.conversation.id,
        streaming: false,
        assistantText: "",
        tools: [],
        error: null,
        proposals: [...saved.proposals].reverse(),
      }));
      setShowHistory(false);
    } catch (error) {
      if (historyOperationRef.current === operation) {
        setHistoryError(
          error instanceof Error ? error.message : t("ai.historyLoadFailed"),
        );
      }
    } finally {
      if (historyOperationRef.current === operation)
        setLoadingConversationId(null);
    }
  };

  const removeConversation = async (id: number) => {
    if (executing || deletingConversationId !== null) return;
    setDeletingConversationId(id);
    setHistoryError(null);
    try {
      await deleteAiConversation(id);
      if (state.conversationId === id) newConversation();
      setConversations((previous) => previous.filter((item) => item.id !== id));
      setConfirmDeleteId(null);
    } catch (error) {
      setHistoryError(
        error instanceof Error ? error.message : t("ai.historyDeleteFailed"),
      );
    } finally {
      setDeletingConversationId(null);
    }
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const status = await getAiStatus();
        if (cancelled) return;

        // Opening the panel is consent to use it. Without this every write
        // 403s through the gate, which surfaces as a bare permission error
        // rather than anything the user can act on.
        if (status.globallyEnabled && !status.enabled) {
          await setAiOptIn(true);
        }
        if (!status.globallyEnabled) return;

        const list = await loadProviders();
        if (!cancelled) void refreshConversations();
        // With nothing configured there is nothing to chat with, so go
        // straight to the form instead of showing a card that just vanishes.
        if (!cancelled && list.length === 0) setShowSettings(true);
      } catch (error) {
        if (!cancelled)
          setSetupError(
            error instanceof Error ? error.message : t("ai.setupFailed"),
          );
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadProviders, refreshConversations, t]);

  // The run's steps stay in the transcript, so the next message does not wipe
  // what the assistant already looked at.
  const keepRun = useCallback(
    (_conversationId: number | null, reply: string, tools: ToolActivity[]) => {
      const runId = runCountRef.current++;
      setHistory((prev) => [
        ...prev,
        ...finishedRunEntries(runId, tools, reply),
      ]);
      void refreshConversations();
    },
    [refreshConversations],
  );

  async function handleSend() {
    const message = input.trim();
    if (
      !message ||
      !providerId ||
      !model.trim() ||
      executing ||
      loadingConversationId !== null
    )
      return;

    jumpToLatest();
    setInput("");
    setHistory((prev) => [...prev, userEntry(message)]);

    await send({
      message,
      providerId,
      model: model.trim(),
      approvalMode,
      executionMode,
      terminalSessionId: getTerminalSessionId?.(),
      terminalContext,
      hostId,
      conversationId: state.conversationId,
      activeTab,
      onComplete: keepRun,
    });
  }

  /**
   * Records the outcome on the card and tells the assistant what happened.
   *
   * Without the follow-up the run just stops: the assistant proposed a
   * command, the user approved it, and the model never learns it produced
   * output, so it sits there as if the tool were still running.
   */
  function handleProposalResolved(
    id: number,
    status: "applied" | "submitted" | "rejected" | "failed",
    resultSummary?: string,
  ) {
    jumpToLatest();
    setResolvedProposals((prev) => ({
      ...prev,
      [id]: { status, resultSummary },
    }));

    // Approval can finish while the model is still streaming. Queue it rather
    // than losing the follow-up or aborting that stream with a second send.
    setPendingResolutions((pending) => [...pending, id]);
  }

  useEffect(() => {
    if (
      state.streaming ||
      !providerId ||
      !state.conversationId ||
      !pendingResolutions.length
    )
      return;
    const [id] = pendingResolutions;
    setPendingResolutions((pending) => pending.slice(1));
    const message = t("ai.summarizeResult");
    setHistory((previous) => [...previous, userEntry(message)]);
    void send({
      message,
      providerId,
      model: model.trim(),
      approvalMode,
      executionMode,
      terminalSessionId: getTerminalSessionId?.(),
      terminalContext,
      hostId,
      conversationId: state.conversationId,
      activeTab,
      resolvedProposalId: id,
      onComplete: keepRun,
    });
  }, [
    state.streaming,
    state.conversationId,
    pendingResolutions,
    providerId,
    model,
    approvalMode,
    executionMode,
    getTerminalSessionId,
    terminalContext,
    hostId,
    activeTab,
    keepRun,
    send,
    t,
  ]);

  const proposals: AiProposal[] = state.proposals.map((proposal) => {
    const resolved = resolvedProposals[proposal.id];
    if (!resolved) return proposal;
    return {
      ...proposal,
      status: resolved.status,
      resultSummary: resolved.resultSummary ?? proposal.resultSummary,
    };
  });

  const timeline = buildTimeline(history, state, proposals);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="animate-spin text-muted-foreground" size={20} />
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/*
        The panel also lives in the narrow sidebar, so the title and the
        provider picker get their own rows rather than competing for one line.
      */}
      <div className="border-b border-border">
        <div className="flex items-center gap-2 px-3 py-2">
          <Sparkles size={16} className="shrink-0" />
          <span className="truncate text-sm font-medium">{t("ai.title")}</span>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={executing || loadingConversationId !== null}
            onClick={newConversation}
            aria-label={t("ai.newConversation")}
            title={t("ai.newConversation")}
          >
            <Plus size={14} />
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={executing}
            onClick={() => {
              setShowHistory((open) => !open);
              setShowSettings(false);
              if (!showHistory) void refreshConversations();
            }}
            aria-label={t("ai.history")}
            title={t("ai.history")}
            aria-expanded={showHistory}
          >
            <History size={14} />
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="shrink-0"
            onClick={() => {
              setShowSettings((value) => !value);
              setShowHistory(false);
            }}
            aria-label={t("ai.chatSettings")}
            title={t("ai.chatSettings")}
            aria-expanded={showSettings}
            aria-controls={settingsId}
          >
            <Settings2 size={14} />
          </Button>
          {approvalMode === "auto" && (
            <span
              role="status"
              className="ml-auto shrink-0 text-[10px] text-destructive"
              title={t("ai.autoModeActive")}
            >
              {t("ai.autoModeCompact")}
            </span>
          )}
        </div>

        {hostId && (
          <p className="truncate px-3 pb-2 text-[11px] text-muted-foreground">
            {t("ai.boundTerminal", {
              host: hostLabel ?? String(hostId),
            })}
          </p>
        )}
      </div>

      {showHistory && (
        <div
          className="max-h-52 overflow-y-auto border-b border-border p-2"
          aria-label={t("ai.history")}
        >
          {conversations.length === 0 && (
            <p className="p-2 text-xs text-muted-foreground">
              {t("ai.historyEmpty")}
            </p>
          )}
          {historyError && (
            <p role="alert" className="p-2 text-xs text-destructive">
              {historyError}
            </p>
          )}
          {conversations.map((conversation) => (
            <div key={conversation.id} className="flex items-center gap-1">
              <button
                type="button"
                className="min-w-0 flex-1 truncate rounded-sm px-2 py-1.5 text-left text-xs hover:bg-muted disabled:opacity-50"
                aria-current={
                  state.conversationId === conversation.id ? "true" : undefined
                }
                disabled={
                  state.streaming ||
                  loadingConversationId !== null ||
                  deletingConversationId !== null
                }
                onClick={() => void openConversation(conversation.id)}
                title={conversation.title ?? t("ai.historyUntitled")}
              >
                {loadingConversationId === conversation.id && (
                  <Loader2 size={12} className="mr-1 inline animate-spin" />
                )}
                {conversation.title || t("ai.historyUntitled")}
              </button>
              {confirmDeleteId === conversation.id ? (
                <>
                  <Button
                    type="button"
                    size="sm"
                    variant="destructive"
                    disabled={deletingConversationId !== null}
                    onClick={() => void removeConversation(conversation.id)}
                    aria-label={t("ai.historyConfirmDelete")}
                  >
                    {t("ai.historyConfirmDelete")}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => setConfirmDeleteId(null)}
                  >
                    {t("common.cancel")}
                  </Button>
                </>
              ) : (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={state.streaming || deletingConversationId !== null}
                  onClick={() => setConfirmDeleteId(conversation.id)}
                  aria-label={t("ai.historyDelete")}
                  title={t("ai.historyDelete")}
                >
                  <Trash2 size={13} />
                </Button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Keep controls mounted: closing settings must not reset the model,
          cancel discovery, or stop a conversation from sending. */}
      <div
        id={settingsId}
        hidden={!showSettings}
        role="region"
        aria-label={t("ai.chatSettings")}
        className="max-h-[55%] shrink-0 overflow-y-auto border-b border-border"
      >
        <section aria-label={t("ai.sessionSettings")}>
          <h3 className="px-3 py-2 text-xs font-medium">
            {t("ai.sessionSettings")}
          </h3>
          {providers.length > 0 && (
            <AiSessionControls
              providers={providers.filter((item) => item.enabled)}
              providerId={providerId}
              onProviderChange={setProviderId}
              model={model}
              onModelChange={setModel}
              approvalMode={approvalMode}
              onApprovalModeChange={setApprovalMode}
              disabled={executing}
              executionMode={executionMode}
              onExecutionModeChange={
                getTerminalSessionId
                  ? (mode) => {
                      setExecutionMode(mode);
                      jumpToLatest();
                    }
                  : undefined
              }
            />
          )}
        </section>
        <details
          className="border-t border-border p-3"
          open={!providers.length}
        >
          <summary className="cursor-pointer text-xs font-medium">
            {t("ai.providerSettings")}
          </summary>
          <div className="pt-2">
            <AiProviderSettings
              providers={providers}
              onChanged={loadProviders}
              onAdded={() => setShowSettings(false)}
            />
          </div>
        </details>
        <p className="border-t border-border px-3 py-2 text-[11px] text-muted-foreground">
          {t("ai.terminalContextAutomatic")}
        </p>
        <a
          href="https://docs.termix.site/features/ai/overview"
          target="_blank"
          rel="noreferrer"
          className="block px-3 pb-2 text-[10px] text-accent-brand hover:underline"
        >
          {t("hosts.docsLink")}
        </a>
      </div>

      <div
        ref={chatScroll.viewportRef}
        onScroll={chatScroll.onScroll}
        onWheel={chatScroll.onWheel}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3"
        style={{ overflowAnchor: "none" }}
        role="log"
        aria-label={t("ai.title")}
      >
        <div ref={chatScroll.contentRef} className="space-y-3">
          {timeline.length === 0 && (
            <p className="text-sm text-muted-foreground">
              {t("ai.chatWelcome")}
            </p>
          )}
          {setupError && (
            <p role="alert" className="text-sm text-destructive">
              {setupError}
            </p>
          )}
          {timeline.map((item) => {
            if (item.kind === "message") {
              return (
                <AiMessage
                  key={item.key}
                  role={item.role}
                  content={item.content}
                />
              );
            }
            if (item.kind === "tool") {
              return (
                <AiToolCall
                  key={item.key}
                  tool={item.tool}
                  streaming={item.live && state.streaming}
                />
              );
            }
            return (
              <ProposalCard
                key={item.key}
                proposal={item.proposal}
                onResolved={handleProposalResolved}
                executionMode={executionMode}
                getTerminalSessionId={getTerminalSessionId}
                onExecuting={(active) =>
                  setExecutingProposalId(active ? item.proposal.id : null)
                }
                disabled={
                  executingProposalId !== null &&
                  executingProposalId !== item.proposal.id
                }
              />
            );
          })}

          {state.error && (
            <div className="rounded-none border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {state.error}
            </div>
          )}
        </div>
      </div>
      {!chatScroll.following && (
        <Button
          type="button"
          size="sm"
          variant="secondary"
          className="mx-auto my-1 shrink-0"
          onClick={jumpToLatest}
        >
          {t("ai.jumpToLatest")}
        </Button>
      )}

      <div className="relative shrink-0 border-t border-border p-3">
        {mentionMatches.length > 0 && (
          <div className="absolute bottom-full left-3 right-3 z-10 max-h-56 overflow-y-auto border border-border bg-popover shadow-md">
            {mentionMatches.map((item, index) => (
              <button
                key={`${item.kind}-${item.id}`}
                type="button"
                className={`flex w-full items-center gap-2 px-2 py-1.5 text-left text-xs ${
                  index === mentionIndex ? "bg-muted" : ""
                }`}
                onMouseDown={(event) => {
                  // mousedown, so the textarea does not lose the caret first.
                  event.preventDefault();
                  insertMention(item);
                }}
              >
                <span className="shrink-0 text-[10px] uppercase text-muted-foreground">
                  {mentionLabel(item.kind)}
                </span>
                <span className="truncate font-medium">{item.label}</span>
                {item.detail && (
                  <span className="ml-auto shrink-0 truncate text-[10px] text-muted-foreground">
                    {item.detail}
                  </span>
                )}
              </button>
            ))}
          </div>
        )}

        <Textarea
          ref={textareaRef}
          className="min-h-[64px] resize-none rounded-none text-sm"
          value={input}
          onChange={(event) => {
            setInput(event.target.value);
            updateMentionQuery(
              event.target.value,
              event.target.selectionStart ?? 0,
            );
          }}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return;
            if (mentionMatches.length > 0) {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setMentionIndex((i) => (i + 1) % mentionMatches.length);
                return;
              }
              if (event.key === "ArrowUp") {
                event.preventDefault();
                setMentionIndex(
                  (i) =>
                    (i - 1 + mentionMatches.length) % mentionMatches.length,
                );
                return;
              }
              if (event.key === "Enter" || event.key === "Tab") {
                event.preventDefault();
                insertMention(mentionMatches[mentionIndex]);
                return;
              }
              if (event.key === "Escape") {
                event.preventDefault();
                setMention(null);
                return;
              }
            }
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void handleSend();
            }
          }}
          placeholder={t("ai.inputPlaceholder")}
          disabled={!providerId || loadingConversationId !== null}
        />
        {/*
          The hint gets its own line and wraps: sharing a row with the send
          button left it truncated to an ellipsis in the sidebar, where the
          panel is at its narrowest.
        */}
        <p className="mt-2 text-[11px] leading-snug text-muted-foreground">
          {t("ai.composerHint")}
        </p>
        <div className="mt-1.5 flex flex-wrap items-center justify-end gap-2">
          {state.streaming ? (
            <Button size="sm" variant="outline" onClick={stop}>
              <Square size={14} />
              {t("ai.stop")}
            </Button>
          ) : (
            <Button
              size="sm"
              variant="outline"
              className="border-accent-brand/40 text-accent-brand hover:bg-accent-brand/10 hover:text-accent-brand"
              disabled={
                executing || !input.trim() || !providerId || !model.trim()
              }
              onClick={() => void handleSend()}
            >
              <Send size={14} />
              {t("ai.send")}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
