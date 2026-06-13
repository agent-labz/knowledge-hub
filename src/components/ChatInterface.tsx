import { useEffect, useRef, useState } from "react";
import { Loader2, Send, Wrench, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  listModels,
  streamChat,
  type ChatMessage,
  type ChatStreamEvent,
} from "@/lib/ingest-client";

type UiMessage =
  | { id: string; role: "user"; content: string }
  | {
      id: string;
      role: "assistant";
      content: string;
      tools: { name: string; arguments: Record<string, unknown>; result?: unknown }[];
      streaming: boolean;
      error?: string;
    };

function uid() {
  return Math.random().toString(36).slice(2);
}

export function ChatInterface() {
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [models, setModels] = useState<string[]>([]);
  const [model, setModel] = useState<string>("");
  const [modelError, setModelError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const r = await listModels();
        setModels(r.models);
        setModel(r.default || r.models[0] || "");
        if (r.models.length === 0) {
          setModelError(
            "No models installed in Ollama. Run: docker exec assistant-ollama ollama pull llama3.2:3b",
          );
        }
      } catch (e) {
        setModelError((e as Error).message);
      }
    })();
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  const send = async () => {
    const text = input.trim();
    if (!text || busy) return;
    setInput("");

    const userMsg: UiMessage = { id: uid(), role: "user", content: text };
    const assistantId = uid();
    const assistantMsg: UiMessage = {
      id: assistantId,
      role: "assistant",
      content: "",
      tools: [],
      streaming: true,
    };
    const next = [...messages, userMsg, assistantMsg];
    setMessages(next);
    setBusy(true);

    // Build wire history (exclude the in-progress assistant placeholder)
    const wire: ChatMessage[] = next
      .filter((m) => m.id !== assistantId)
      .map((m) =>
        m.role === "user"
          ? { role: "user", content: m.content }
          : { role: "assistant", content: m.content },
      );

    const controller = new AbortController();
    abortRef.current = controller;

    const onEvent = (e: ChatStreamEvent) => {
      setMessages((prev) =>
        prev.map((m) => {
          if (m.id !== assistantId || m.role !== "assistant") return m;
          if (e.type === "token") return { ...m, content: m.content + e.text };
          if (e.type === "tool_call")
            return { ...m, tools: [...m.tools, { name: e.name, arguments: e.arguments }] };
          if (e.type === "tool_result") {
            const tools = [...m.tools];
            // attach to most recent matching call without a result
            for (let i = tools.length - 1; i >= 0; i--) {
              if (tools[i].name === e.name && tools[i].result === undefined) {
                tools[i] = { ...tools[i], result: e.result };
                break;
              }
            }
            return { ...m, tools };
          }
          if (e.type === "done") return { ...m, streaming: false };
          if (e.type === "error") return { ...m, streaming: false, error: e.message };
          return m;
        }),
      );
    };

    try {
      await streamChat(wire, { model: model || undefined, signal: controller.signal, onEvent });
    } catch (e) {
      onEvent({ type: "error", message: (e as Error).message });
    } finally {
      setBusy(false);
      abortRef.current = null;
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId && m.role === "assistant" ? { ...m, streaming: false } : m,
        ),
      );
    }
  };

  const stop = () => abortRef.current?.abort();
  const clear = () => {
    if (busy) stop();
    setMessages([]);
  };

  return (
    <div className="flex h-[calc(100vh-8rem)] flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Model</span>
          <Select value={model} onValueChange={setModel} disabled={models.length === 0}>
            <SelectTrigger className="h-8 w-[220px]">
              <SelectValue placeholder="No models" />
            </SelectTrigger>
            <SelectContent>
              {models.map((m) => (
                <SelectItem key={m} value={m}>
                  {m}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button variant="ghost" size="sm" onClick={clear} disabled={messages.length === 0}>
          <Trash2 className="mr-1 h-3.5 w-3.5" />
          New chat
        </Button>
      </div>

      {modelError && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
          {modelError}
        </div>
      )}

      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto rounded-lg border border-border bg-card/50 p-4"
      >
        {messages.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <p className="max-w-md text-center text-sm text-muted-foreground">
              Ask anything. The assistant can search your uploaded documents and the web
              via tool calls.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {messages.map((m) => (
              <MessageBubble key={m.id} m={m} />
            ))}
          </div>
        )}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
        className="flex items-end gap-2"
      >
        <Textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          placeholder="Ask the assistant…"
          className="min-h-[60px] flex-1 resize-none"
          disabled={busy && !abortRef.current}
        />
        {busy ? (
          <Button type="button" variant="secondary" onClick={stop}>
            Stop
          </Button>
        ) : (
          <Button type="submit" disabled={!input.trim() || !model}>
            <Send className="h-4 w-4" />
          </Button>
        )}
      </form>
    </div>
  );
}

function MessageBubble({ m }: { m: UiMessage }) {
  if (m.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] whitespace-pre-wrap rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground">
          {m.content}
        </div>
      </div>
    );
  }
  return (
    <div className="flex flex-col items-start gap-2">
      {m.tools.length > 0 && (
        <div className="w-full space-y-1.5">
          {m.tools.map((t, i) => (
            <details
              key={i}
              className="rounded-md border border-border bg-muted/40 px-3 py-1.5 text-xs"
            >
              <summary className="flex cursor-pointer items-center gap-1.5 text-muted-foreground">
                <Wrench className="h-3 w-3" />
                <span className="font-medium text-foreground">{t.name}</span>
                <span className="truncate">
                  {Object.entries(t.arguments)
                    .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
                    .join(" ")}
                </span>
                {t.result === undefined && (
                  <Loader2 className="ml-auto h-3 w-3 animate-spin" />
                )}
              </summary>
              <pre className="mt-2 max-h-48 overflow-auto text-[10px] leading-relaxed text-muted-foreground">
                {JSON.stringify(t.result ?? null, null, 2)}
              </pre>
            </details>
          ))}
        </div>
      )}
      {(m.content || m.streaming) && (
        <div className="max-w-[90%] whitespace-pre-wrap text-sm text-foreground">
          {m.content}
          {m.streaming && <span className="ml-0.5 inline-block h-3 w-1.5 animate-pulse bg-foreground/60 align-middle" />}
        </div>
      )}
      {m.error && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {m.error}
        </div>
      )}
    </div>
  );
}
