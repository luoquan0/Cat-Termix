/**
 * Core-owned sudo transport. The password is decrypted only inside core and
 * sent on a dedicated SSH stdin channel. It is never part of the shell
 * command, the plugin-facing connection, or a job/audit payload.
 */
import type { Client, ClientChannel } from "ssh2";

export interface SudoCommandOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
  onStdout?: (chunk: string) => void;
  onStderr?: (chunk: string) => void;
}

function shellQuote(text: string): string {
  return "'" + text.replace(/'/g, "'\\''") + "'";
}

/**
 * Close the elevated command's stdin before running user content. In the
 * NOPASSWD/cached-sudo case, sudo does not consume the supplied password;
 * without this redirect the root command could read it from stdin.
 */
export function sudoCommandLine(command: string): string {
  return (
    "sudo -k -S -p '' -- sh -c " + shellQuote("exec 0</dev/null; " + command)
  );
}

export function runSudoCommand(
  client: Pick<Client, "exec">,
  command: string,
  password: string,
  options: SudoCommandOptions = {},
): Promise<{ exitCode: number | null }> {
  if (
    typeof command !== "string" ||
    !command.trim() ||
    command.length > 65536 ||
    command.includes("\0")
  ) {
    return Promise.reject(new Error("INVALID_SUDO_COMMAND"));
  }
  if (!password || /[\r\n\0]/.test(password)) {
    return Promise.reject(new Error("SUDO_PASSWORD_NOT_CONFIGURED"));
  }
  const timeoutMs = options.timeoutMs ?? 30000;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 900000) {
    return Promise.reject(new Error("INVALID_SUDO_TIMEOUT"));
  }
  if (options.signal?.aborted) {
    return Promise.reject(new Error("Sudo command canceled"));
  }
  return new Promise((resolve, reject) => {
    let stream: ClientChannel | undefined;
    let settled = false;
    let exitCode: number | null = null;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", abort);
      if (error) reject(error);
      else resolve({ exitCode });
    };
    const abort = () => {
      finish(new Error("Sudo command canceled"));
      stream?.close();
    };
    const timer = setTimeout(() => {
      finish(new Error("Sudo command timed out"));
      stream?.close();
    }, timeoutMs);
    options.signal?.addEventListener("abort", abort, { once: true });
    try {
      client.exec(sudoCommandLine(command), (error, channel) => {
        if (settled) {
          channel?.close();
          return;
        }
        if (error) {
          finish(error);
          return;
        }
        if (!channel) {
          finish(new Error("Sudo SSH channel unavailable"));
          return;
        }
        stream = channel;
        channel.on("data", (data: Buffer | string) =>
          options.onStdout?.(data.toString()),
        );
        channel.stderr.on("data", (data: Buffer | string) =>
          options.onStderr?.(data.toString()),
        );
        channel.on("exit", (code: number | null) => {
          exitCode = code;
        });
        channel.on("error", (failure: Error) => finish(failure));
        channel.on("close", () => finish());
        // A single authentication line, on SSH stdin; never interpolate it
        // into the remote command or return it to the calling plugin.
        channel.end(password + "\n");
      });
    } catch (error) {
      finish(
        error instanceof Error ? error : new Error("Sudo SSH exec failed"),
      );
    }
  });
}
