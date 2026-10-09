import { randomUUID } from "node:crypto";
import { stripVTControlCharacters } from "node:util";
import type { TerminalSession } from "./session-manager.js";

export interface SharedCommandResult {
  output: string;
  error?: string;
  code: number | null;
}
interface PendingRun {
  begin: string;
  end: string;
  pending: string;
  started: boolean;
  code: number | null;
  output: string;
  truncated: boolean;
  header: string;
  finish: (reason?: string) => void;
  cancel: (reason: string) => void;
}
interface PromptState {
  ready: boolean;
  dirty: boolean;
  alternate: boolean;
  tail: string;
  run?: PendingRun;
}
const LIMIT = 64 * 1024;

/** Executes on the existing PTY, never a second SSH connection. */
export class SharedTerminalRunner {
  private states = new Map<string, PromptState>();
  private state(id: string): PromptState {
    let state = this.states.get(id);
    if (!state) {
      state = { ready: false, dirty: false, alternate: false, tail: "" };
      this.states.set(id, state);
    }
    return state;
  }
  isReady(id: string): boolean {
    const s = this.state(id);
    return s.ready && !s.dirty && !s.alternate && !s.run;
  }
  /** Gate human/service input before writing to the PTY. Ctrl+C takes over. */
  input(id: string, data: string): boolean {
    const s = this.state(id);
    if (s.run) {
      if (data.includes("\x03")) s.run.cancel("Interrupted by the user (Ctrl+C)");
      return false;
    }
    if (/^\x1b\[[?\d;]*[Rcn]$/.test(data)) return true;
    if (/[\r\n\x03]/.test(data)) {
      s.ready = false;
      s.dirty = false;
    } else if (data) s.dirty = true;
    return true;
  }
  /** Observe Readline prompt state, without guessing from a printed dollar sign. */
  filterOutput(id: string, data: string): string {
    const s = this.state(id);
    const controls = s.tail + data;
    const pattern = /\x1b\[\?(2004|1049|1047|47)([hl])/g;
    for (const match of controls.matchAll(pattern)) {
      if (match[1] === "2004") {
        s.ready = match[2] === "h";
        if (s.ready) s.dirty = false;
      } else s.alternate = match[2] === "h";
    }
    const escape = controls.lastIndexOf("\x1b");
    const tail = escape >= 0 ? controls.slice(escape) : "";
    s.tail = /^\x1b(?:\[(?:\?(?:\d*)?)?)?$/.test(tail) ? tail : "";
    const run = s.run;
    if (!run) return data;
    if (run.code !== null) {
      if (s.ready) run.finish();
      return data;
    }
    run.pending += data;
    let visible = "";
    if (!run.started) {
      const start = run.pending.indexOf(run.begin);
      if (start < 0) {
        run.pending = run.pending.slice(-(run.begin.length - 1));
        return "";
      }
      run.started = true;
      run.pending = run.pending.slice(start + run.begin.length);
      visible = run.header;
    }
    const end = run.pending.indexOf(run.end);
    if (end >= 0) {
      const closing = run.pending.indexOf("\x1f", end + run.end.length);
      if (closing >= 0) {
        const code = run.pending.slice(end + run.end.length, closing);
        if (/^\d{1,3}$/.test(code)) {
          const output = run.pending.slice(0, end);
          this.capture(run, output);
          run.code = Number(code);
          visible += output + `\r\n[AI] exit: ${code}\r\n` + run.pending.slice(closing + 1);
          run.pending = "";
          if (s.ready) run.finish();
          return visible;
        }
      }
    }
    let keep = 0;
    for (let size = Math.min(run.end.length - 1, run.pending.length); size > 0; size--) {
      if (run.end.startsWith(run.pending.slice(-size))) { keep = size; break; }
    }
    const safe = end >= 0 ? end : run.pending.length - keep;
    const output = run.pending.slice(0, safe);
    this.capture(run, output);
    run.pending = run.pending.slice(safe);
    return visible + output;
  }
  private capture(run: PendingRun, data: string): void {
    const remaining = LIMIT - run.output.length;
    run.output += data.slice(0, Math.max(0, remaining));
    if (data.length > remaining) run.truncated = true;
  }
  async execute(
    session: TerminalSession,
    command: string,
    signal: AbortSignal | undefined,
    busy: (active: boolean) => void,
    timeoutMs = 60_000,
  ): Promise<SharedCommandResult> {
    const s = this.state(session.id);
    if (signal?.aborted) throw new Error("The user stopped this run");
    if (!session.isConnected || !session.sshStream || session.sshStream.destroyed)
      throw new Error("The shared terminal is disconnected; no command was sent");
    if (!this.isReady(session.id))
      throw new Error("Shared terminal is busy or its idle shell prompt is unconfirmed. Finish the current program/input and press Enter at a Bash/zsh prompt, or select isolated execution. No command was sent.");
    if (!command.trim() || command.length > 16_384 || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(command))
      throw new Error("Command is empty, too long or contains terminal control characters");
    const stream = session.sshStream;
    const nonce = randomUUID().replace(/-/g, "");
    const prefix = `CAT_AI_${nonce}`;
    const encoded = Buffer.from(command, "utf8").toString("base64");
    // A foreground subshell inherits cwd/environment/TTY. Its exit/exec cannot
    // terminate the user's shell. Single-line transport supports multiline scripts.
    const wrapper = ` printf '\\036${prefix}_B\\037'; ( __ct_cmd=$(printf '%s' '${encoded}' | base64 -d) && eval "$__ct_cmd" ); printf '\\036${prefix}_E:%s\\037' "$?"\r`;
    return new Promise<SharedCommandResult>((resolve) => {
      let settled = false;
      const finish = (reason?: string) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener("abort", aborted);
        stream.removeListener("close", closed);
        stream.removeListener("error", closed);
        if (s.run === run) s.run = undefined;
        busy(false);
        const output = stripVTControlCharacters(run.output) +
          (run.truncated ? "\n[Output truncated at 65536 characters]" : "");
        const error = reason || (run.code !== 0 ? `Exited with code ${run.code}` : undefined);
        resolve({ output, code: run.code, ...(error ? { error: `${error}${output ? `\n${output}` : ""}` } : {}) });
      };
      const cancel = (reason: string) => {
        s.ready = false;
        try { stream.write("\x03"); } catch { /* already disconnected */ }
        if (run.started) this.capture(run, run.pending);
        finish(reason);
      };
      const aborted = () => cancel("Stopped by the user; completed changes were not rolled back");
      const closed = () => finish("Terminal connection ended before a verified result");
      const run: PendingRun = {
        begin: `\x1e${prefix}_B\x1f`, end: `\x1e${prefix}_E:`, pending: "",
        started: false, code: null, output: "", truncated: false,
        header: `\r\n[AI] $ ${command.replace(/\r?\n/g, "\r\n> ")}\r\n`,
        finish, cancel,
      };
      s.ready = false;
      s.run = run;
      const timer = setTimeout(() => cancel("Shared terminal command timed out; verify the host before retrying"), timeoutMs);
      signal?.addEventListener("abort", aborted, { once: true });
      stream.once("close", closed);
      stream.once("error", closed);
      busy(true);
      if (signal?.aborted) { aborted(); return; }
      try { stream.write(wrapper); } catch { closed(); }
    });
  }
  cancel(id: string, reason: string): void { this.states.get(id)?.run?.cancel(reason); }
  forget(id: string): void {
    this.cancel(id, "Shared terminal was closed");
    this.states.delete(id);
  }
}
