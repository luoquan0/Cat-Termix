import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useChatScroll } from "../../src/frontend/use-chat-scroll";
let jobs=new Map<number, FrameRequestCallback>();let next=1;let resize:()=>void;
beforeEach(()=>{
  jobs=new Map();next=1;
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback)=>{ const id=next++;jobs.set(id,cb);return id; });
  vi.stubGlobal("cancelAnimationFrame",(id:number)=>jobs.delete(id));
  vi.stubGlobal("ResizeObserver",class {
    constructor(cb:()=>void){resize=cb;}
    observe(){} disconnect(){}
  });
});
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
function flush(){act(()=>{const work=[...jobs.values()];jobs.clear();for(const fn of work)fn(0);});}
function Harness(){const scroll=useChatScroll(true);return <>
  <div data-testid="viewport" ref={scroll.viewportRef} onScroll={scroll.onScroll} onWheel={scroll.onWheel}>
    <div ref={scroll.contentRef}>content</div>
  </div>
  <button onClick={scroll.jumpToLatest}>latest</button><span>{scroll.following?"following":"reading"}</span>
</>;}
it("follows expanded output and resized viewports but preserves manual history reading",()=>{
  render(<Harness/>);const viewport=screen.getByTestId("viewport");
  let height=1000;Object.defineProperty(viewport,"scrollHeight",{get:()=>height});
  Object.defineProperty(viewport,"clientHeight",{value:200});
  flush();expect(viewport.scrollTop).toBe(1000);
  height=1600;act(()=>resize());flush();expect(viewport.scrollTop).toBe(1600);
  fireEvent.wheel(viewport,{deltaY:-100});viewport.scrollTop=600;fireEvent.scroll(viewport);
  expect(screen.getByText("reading")).toBeTruthy();
  height=2000;act(()=>resize());flush();expect(viewport.scrollTop).toBe(600);
  fireEvent.click(screen.getByText("latest"));flush();expect(viewport.scrollTop).toBe(2000);
  expect(screen.getByText("following")).toBeTruthy();
});
