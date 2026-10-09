import { assertOk, joinUrl, readSseLines } from "./http.js";
import type {
  ChatChunk,
  ChatRequest,
  ProviderAdapter,
  ProviderConfig,
  ToolCall,
} from "./types.js";
import { AiProviderError } from "./types.js";

const OPENAI_DEFAULT_BASE = "https://api.openai.com/v1";

function baseFor(config: ProviderConfig): string {
  if (config.baseUrl?.trim()) {
    // Some proxy UIs tell users to paste the full completions endpoint.
    // Normalize it once for both chat/completions and models.
    return config.baseUrl
      .trim()
      .replace(/\/(?:chat\/completions|responses|models)\/?$/i, "")
      .replace(/\/+$/, "");
  }
  if (config.providerType === "openai") return OPENAI_DEFAULT_BASE;
  throw new AiProviderError("This provider needs a base URL");
}

function toOpenAiMessages(request: ChatRequest): unknown[] {
  const messages: unknown[] = [{ role: "system", content: request.system }];

  for (const message of request.messages) {
    if (message.role === "tool") {
      messages.push({
        role: "tool",
        tool_call_id: message.toolCallId,
        content: message.content,
      });
      continue;
    }

    if (message.role === "assistant" && message.toolCalls?.length) {
      messages.push({
        role: "assistant",
        content: message.content || null,
        tool_calls: message.toolCalls.map((call) => ({
          id: call.id,
          type: "function",
          function: {
            name: call.name,
            arguments: JSON.stringify(call.arguments),
          },
        })),
      });
      continue;
    }

    messages.push({ role: message.role, content: message.content });
  }

  return messages;
}

/**
 * Tool call arguments arrive as JSON fragments spread across many deltas, so
 * they are accumulated per index and only parsed once the stream ends.
 */
interface PartialCall {
  id: string;
  name: string;
  args: string;
}

export const openAiAdapter: ProviderAdapter = {
  async *streamChat(
    config: ProviderConfig,
    request: ChatRequest,
  ): AsyncIterable<ChatChunk> {
    const url = joinUrl(baseFor(config), "chat/completions");

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`;

    const payload: Record<string, unknown> = {
      model: request.model,
      messages: toOpenAiMessages(request),
      stream: true,
      ...(config.providerType === "openai"
        ? { stream_options: { include_usage: true } }
        : {}),
      ...(request.maxOutputTokens
        ? config.providerType === "openai"
          ? { max_completion_tokens: request.maxOutputTokens }
          : { max_tokens: request.maxOutputTokens }
        : {}),
      ...(request.tools.length
        ? {
            tools: request.tools.map((tool) => ({
              type: "function",
              function: {
                name: tool.name,
                description: tool.description,
                parameters: tool.parameters,
              },
            })),
          }
        : {}),
    };
    const send = () =>
      config.fetch(url, {
        method: "POST",
        headers,
        signal: request.signal,
        body: JSON.stringify(payload),
      });
    let response = await send();
    if (response.status === 400 && request.maxOutputTokens) {
      const body = await response.clone().text();
      const rejected =
        "max_tokens" in payload ? "max_tokens" : "max_completion_tokens";
      // Compatible gateways differ. Retry once only for an explicitly rejected
      // parameter before a stream starts; retain the exact output budget.
      if (
        body.includes(rejected) &&
        /unsupported|not supported|unrecognized|unknown parameter/i.test(body)
      ) {
        await response.body?.cancel();
        delete payload[rejected];
        payload[
          rejected === "max_tokens" ? "max_completion_tokens" : "max_tokens"
        ] = request.maxOutputTokens;
        response = await send();
      }
    }

    await assertOk(response, "OpenAI");

    const partial = new Map<number, PartialCall>();
    let stopReason: string | undefined;

    for await (const data of readSseLines(response)) {
      if (data === "[DONE]") break;

      let frame: any;
      try {
        frame = JSON.parse(data);
      } catch {
        continue;
      }

      if (Number.isFinite(frame.usage?.prompt_tokens)) {
        yield {
          type: "usage",
          inputTokens: frame.usage.prompt_tokens,
          outputTokens: frame.usage.completion_tokens,
        };
      }
      const choice = frame.choices?.[0];
      if (!choice) continue;

      if (choice.finish_reason) stopReason = choice.finish_reason;

      const delta = choice.delta;
      if (!delta) continue;

      if (typeof delta.content === "string" && delta.content) {
        yield { type: "text", text: delta.content };
      }

      for (const call of delta.tool_calls ?? []) {
        const index = call.index ?? 0;
        const existing = partial.get(index) ?? { id: "", name: "", args: "" };
        if (call.id) existing.id = call.id;
        if (call.function?.name) existing.name = call.function.name;
        if (call.function?.arguments) existing.args += call.function.arguments;
        partial.set(index, existing);
      }
    }

    for (const call of partial.values()) {
      if (!call.name) continue;
      yield { type: "tool_call", call: finalizeCall(call) };
    }

    yield { type: "done", stopReason };
  },

  async listModels(config: ProviderConfig): Promise<string[]> {
    const headers: Record<string, string> = {};
    if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`;

    const response = await config.fetch(joinUrl(baseFor(config), "models"), {
      method: "GET",
      headers,
    });
    await assertOk(response, "OpenAI");

    const body: any = await response.json();
    return (body.data ?? [])
      .map((entry: any) => entry.id)
      .filter((id: unknown): id is string => typeof id === "string")
      .sort();
  },
};

export function finalizeCall(call: PartialCall): ToolCall {
  let args: Record<string, unknown> = {};
  if (call.args.trim()) {
    try {
      const parsed = JSON.parse(call.args);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        args = parsed as Record<string, unknown>;
      }
    } catch {
      // A model that emitted malformed arguments gets an empty object; the
      // tool's own schema validation reports the problem back to it.
      args = {};
    }
  }
  return {
    id:
      call.id || `call_${call.name}_${Math.random().toString(36).slice(2, 10)}`,
    name: call.name,
    arguments: args,
  };
}
