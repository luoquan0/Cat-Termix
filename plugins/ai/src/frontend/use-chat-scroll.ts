import { useCallback, useLayoutEffect, useRef, useState } from "react";

/** Follow growing output without stealing the viewport while reading history. */
export function useChatScroll(enabled: boolean) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const followRef = useRef(true);
  const lastTopRef = useRef(0);
  const frameRef = useRef<number | null>(null);
  const [following, setFollowing] = useState(true);
  const schedule = useCallback(() => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      const viewport = viewportRef.current;
      if (!viewport || !followRef.current) return;
      viewport.scrollTop = viewport.scrollHeight;
      lastTopRef.current = viewport.scrollTop;
    });
  }, []);
  const jumpToLatest = useCallback(() => {
    followRef.current = true;
    setFollowing(true);
    schedule();
  }, [schedule]);
  const onScroll = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const nearEnd = viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop < 64;
    if (nearEnd) {
      followRef.current = true;
      setFollowing(true);
    } else if (viewport.scrollTop < lastTopRef.current - 1) {
      followRef.current = false;
      setFollowing(false);
    }
    lastTopRef.current = viewport.scrollTop;
  }, []);
  const onWheel = useCallback((event: { deltaY: number }) => {
    if (event.deltaY < 0) {
      followRef.current = false;
      setFollowing(false);
    }
  }, []);
  useLayoutEffect(() => {
    if (!enabled) return;
    schedule();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(schedule);
    if (contentRef.current) observer?.observe(contentRef.current);
    if (viewportRef.current) observer?.observe(viewportRef.current);
    return () => {
      observer?.disconnect();
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    };
  }, [enabled, schedule]);
  useLayoutEffect(() => { if (enabled) schedule(); });
  return { viewportRef, contentRef, following, onScroll, onWheel, jumpToLatest };
}
