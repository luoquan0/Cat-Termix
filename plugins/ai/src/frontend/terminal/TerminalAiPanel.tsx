import { useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "@termix/plugin-sdk/frontend";
import { Bot, GripVertical, X } from "lucide-react";
import { Button } from "@termix/plugin-sdk/ui";
import { AiPanel } from "../AiPanel";
import {
  clampToolbarPosition,
  persistAiPanelPosition,
  readStoredAiPanelPosition,
  type ToolbarPosition,
} from "./panel-geometry";

interface TerminalAiPanelProps {
  hostLabel: string;
  hostId: number;
  activeTab?: string | null;
  initialContext?: string;
  getTerminalContext?: () => string;
  getTerminalSessionId?: () => string | null;
  onRunInTerminal?: (command: string) => boolean;
  onClose: () => void;
}

/** A resizable, non-modal workspace. AI exec never writes into the user's PTY. */
export function TerminalAiPanel({
  hostLabel,
  hostId,
  activeTab,
  initialContext,
  getTerminalContext,
  getTerminalSessionId,
  onRunInTerminal,
  onClose,
}: TerminalAiPanelProps) {
  const { t } = useTranslation();
  const [position, setPosition] = useState<ToolbarPosition>(
    readStoredAiPanelPosition,
  );
  const positionRef = useRef(position);
  positionRef.current = position;
  const panelRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    pointerId: number;
    x: number;
    y: number;
    base: ToolbarPosition;
  } | null>(null);

  useLayoutEffect(() => {
    const panel = panelRef.current;
    const host = panel?.offsetParent as HTMLElement | null;
    if (!panel || !host) return;
    const clamp = () => {
      const next = clampToolbarPosition(
        positionRef.current,
        panel.getBoundingClientRect(),
        host.getBoundingClientRect(),
        positionRef.current,
      );
      if (
        next.x !== positionRef.current.x ||
        next.y !== positionRef.current.y
      ) {
        positionRef.current = next;
        setPosition(next);
      }
    };
    clamp();
    const observer =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(clamp);
    observer?.observe(host);
    observer?.observe(panel);
    return () => observer?.disconnect();
  }, []);

  const endDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    persistAiPanelPosition(positionRef.current);
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
  };

  return (
    <div
      ref={panelRef}
      role="region"
      aria-label={t("ai.terminalWorkspace")}
      className="absolute right-2 top-12 z-[120] flex max-h-[calc(100%-4rem)] max-w-[calc(100%-1rem)] flex-col overflow-hidden border border-border bg-background shadow-xl"
      style={{
        width: "min(560px, calc(100% - 1rem))",
        height: "min(720px, calc(100% - 4rem))",
        minWidth: "min(320px, calc(100% - 1rem))",
        minHeight: "min(360px, calc(100% - 4rem))",
        resize: "both",
        transform: `translate(${position.x}px, ${position.y}px)`,
      }}
      onClick={(event) => event.stopPropagation()}
    >
      <div
        className="flex shrink-0 cursor-grab items-center gap-2 border-b border-border px-3 py-2 active:cursor-grabbing"
        onPointerDown={(event) => {
          if (
            event.button !== 0 ||
            (event.target as HTMLElement).closest("button")
          )
            return;
          event.currentTarget.setPointerCapture?.(event.pointerId);
          dragRef.current = {
            pointerId: event.pointerId,
            x: event.clientX,
            y: event.clientY,
            base: positionRef.current,
          };
        }}
        onPointerMove={(event) => {
          const drag = dragRef.current;
          const panel = panelRef.current;
          const host = panel?.offsetParent as HTMLElement | null;
          if (!drag || drag.pointerId !== event.pointerId || !panel || !host)
            return;
          const next = clampToolbarPosition(
            {
              x: drag.base.x + event.clientX - drag.x,
              y: drag.base.y + event.clientY - drag.y,
            },
            panel.getBoundingClientRect(),
            host.getBoundingClientRect(),
            positionRef.current,
          );
          positionRef.current = next;
          setPosition(next);
        }}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onLostPointerCapture={endDrag}
      >
        <GripVertical className="size-4 shrink-0 text-muted-foreground" />
        <Bot className="size-4 shrink-0 text-accent-brand" />
        <span className="min-w-0 flex-1 truncate text-xs font-medium">
          {hostLabel}
        </span>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="size-7"
          onClick={onClose}
          title={t("common.close")}
          aria-label={t("common.close")}
        >
          <X size={14} />
        </Button>
      </div>
      <div className="min-h-0 flex-1">
        <AiPanel
          key={hostId}
          hostId={hostId}
          hostLabel={hostLabel}
          activeTab={activeTab}
          initialContext={initialContext}
          getTerminalContext={getTerminalContext}
          getTerminalSessionId={getTerminalSessionId}
          onRunInTerminal={onRunInTerminal}
        />
      </div>
    </div>
  );
}
