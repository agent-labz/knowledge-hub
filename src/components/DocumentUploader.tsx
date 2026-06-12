import { useCallback, useRef, useState } from "react";
import { Upload, FileText, CheckCircle2, XCircle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { uploadDocument } from "@/lib/ingest-client";
import { cn } from "@/lib/utils";

type Status = "queued" | "uploading" | "done" | "error";

interface QueueItem {
  id: string;
  file: File;
  status: Status;
  error?: string;
  chunks?: number;
}

const ACCEPT = ".pdf,.docx,.txt,.html,.htm,.md,.markdown";

export function DocumentUploader({ onUploaded }: { onUploaded?: () => void }) {
  const [items, setItems] = useState<QueueItem[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const processFiles = useCallback(
    async (files: FileList | File[]) => {
      const queued: QueueItem[] = Array.from(files).map((f) => ({
        id: `${f.name}-${f.size}-${Date.now()}-${Math.random()}`,
        file: f,
        status: "queued" as Status,
      }));
      setItems((prev) => [...queued, ...prev]);

      for (const item of queued) {
        setItems((prev) =>
          prev.map((it) => (it.id === item.id ? { ...it, status: "uploading" } : it)),
        );
        try {
          const result = await uploadDocument(item.file);
          setItems((prev) =>
            prev.map((it) =>
              it.id === item.id ? { ...it, status: "done", chunks: result.chunks } : it,
            ),
          );
          onUploaded?.();
        } catch (e) {
          setItems((prev) =>
            prev.map((it) =>
              it.id === item.id
                ? { ...it, status: "error", error: (e as Error).message }
                : it,
            ),
          );
        }
      }
    },
    [onUploaded],
  );

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files?.length) {
      void processFiles(e.dataTransfer.files);
    }
  };

  return (
    <div className="space-y-4">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
        className={cn(
          "flex cursor-pointer flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed p-10 text-center transition-colors",
          dragOver
            ? "border-primary bg-accent"
            : "border-border hover:border-primary/50 hover:bg-accent/30",
        )}
      >
        <Upload className="h-10 w-10 text-muted-foreground" />
        <div>
          <p className="text-base font-medium text-foreground">
            Drop documents here or click to browse
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            PDF, DOCX, TXT, HTML, Markdown
          </p>
        </div>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={ACCEPT}
          className="hidden"
          onChange={(e) => {
            if (e.target.files?.length) void processFiles(e.target.files);
            e.target.value = "";
          }}
        />
      </div>

      {items.length > 0 && (
        <div className="space-y-2">
          {items.map((item) => (
            <div
              key={item.id}
              className="flex items-center gap-3 rounded-md border border-border bg-card p-3"
            >
              <FileText className="h-5 w-5 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-foreground">
                  {item.file.name}
                </p>
                <p className="text-xs text-muted-foreground">
                  {item.status === "uploading" && "Parsing and embedding…"}
                  {item.status === "queued" && "Queued"}
                  {item.status === "done" && `Ingested — ${item.chunks} chunks`}
                  {item.status === "error" && (
                    <span className="text-destructive">{item.error}</span>
                  )}
                </p>
              </div>
              <StatusIcon status={item.status} />
            </div>
          ))}
          {items.some((i) => i.status === "done" || i.status === "error") && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                setItems((prev) =>
                  prev.filter((i) => i.status !== "done" && i.status !== "error"),
                )
              }
            >
              Clear finished
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

function StatusIcon({ status }: { status: Status }) {
  if (status === "uploading")
    return <Loader2 className="h-5 w-5 animate-spin text-primary" />;
  if (status === "done")
    return <CheckCircle2 className="h-5 w-5 text-green-600" />;
  if (status === "error") return <XCircle className="h-5 w-5 text-destructive" />;
  return <div className="h-5 w-5 rounded-full border-2 border-muted" />;
}
