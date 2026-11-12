/** Local migration adapter: the v26 SDK command helper removed abort/output limits.
 * Keep Cat's bounded, cancelable SSH exec until core exposes equivalent options.
 */
import type { Client, ClientChannel } from "ssh2";

interface ExecResult {
  stdout: string;
  stderr: string;
  code: number | null;
}

export function execAiCommand(
  client: Client,
  command: string,
  timeoutMs = 30000,
  options: { signal?: AbortSignal; maxOutputBytes?: number } = {},
): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    const { signal } = options;
    if (signal?.aborted) {
      reject(
        new Error(
          "Command interrupted; completed changes were not rolled back",
        ),
      );
      return;
    }
    let settled = false;
    let stream: ClientChannel | null = null;

    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        cleanup();
        reject(new Error(`Command timeout after ${timeoutMs}ms`));
      }
    }, timeoutMs);

    const onAbort = () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(
        new Error(
          "Command interrupted; completed changes were not rolled back",
        ),
      );
    };

    const cleanup = () => {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", onAbort);
      if (stream) {
        try {
          stream.removeAllListeners();
          if (stream.stderr) {
            stream.stderr.removeAllListeners();
          }
          stream.destroy();
        } catch {
          // expected - cleanup errors ignored
        }
      }
    };

    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) {
      onAbort();
      return;
    }

    client.exec(command, { pty: false }, (err, _stream) => {
      if (err) {
        if (!settled) {
          settled = true;
          cleanup();
          reject(err);
        }
        return;
      }

      stream = _stream;
      // Abort/timeout may have won while SSH was opening the exec channel.
      if (settled) {
        cleanup();
        return;
      }
      let capturedBytes = 0;
      let truncated = false;
      const capture = (data: Buffer): string => {
        if (options.maxOutputBytes === undefined) return data.toString("utf8");
        const remaining = Math.max(0, options.maxOutputBytes - capturedBytes);
        const kept = data.subarray(0, remaining);
        capturedBytes += kept.length;
        const marker =
          data.length > remaining && !truncated ? "\n[output truncated]\n" : "";
        if (data.length > remaining) truncated = true;
        return kept.toString("utf8") + marker;
      };
      let stdout = "";
      let stderr = "";
      let exitCode: number | null = null;

      stream
        .on("close", (code: number | undefined) => {
          if (!settled) {
            settled = true;
            exitCode = typeof code === "number" ? code : null;
            cleanup();
            resolve({ stdout, stderr, code: exitCode });
          }
        })
        .on("data", (data: Buffer) => {
          stdout += capture(data);
        })
        .on("error", (streamErr: Error) => {
          if (!settled) {
            settled = true;
            cleanup();
            reject(streamErr);
          }
        });

      if (stream.stderr) {
        stream.stderr
          .on("data", (data: Buffer) => {
            stderr += capture(data);
          })
          .on("error", (stderrErr: Error) => {
            if (!settled) {
              settled = true;
              cleanup();
              reject(stderrErr);
            }
          });
      }
    });
  });
}

