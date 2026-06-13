import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AlertCircle, CheckCircle2, Copy, Database, MessageSquare } from "lucide-react";
import { DocumentUploader } from "@/components/DocumentUploader";
import { DocumentList } from "@/components/DocumentList";
import { WebSearchPanel } from "@/components/WebSearchPanel";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ingestUrl, ping } from "@/lib/ingest-client";

export const Route = createFileRoute("/documents")({
  head: () => ({
    meta: [
      { title: "Documents — Personal Assistant" },
      {
        name: "description",
        content:
          "Ingest documents into a local ChromaDB vector store for your personal assistant.",
      },
      { property: "og:title", content: "Documents — Personal Assistant" },
      {
        property: "og:description",
        content: "Upload documents and build your local knowledge base.",
      },
    ],
  }),
  component: DocumentsPage,
});

function DocumentsPage() {
  const [online, setOnline] = useState<boolean | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      const ok = await ping();
      if (!cancelled) setOnline(ok);
    };
    void check();
    const t = setInterval(check, 5000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-2">
            <Database className="h-5 w-5 text-primary" />
            <h1 className="text-base font-semibold text-foreground">
              Personal Assistant
            </h1>
          </div>
          <SidecarBadge online={online} />
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-8">
        {online === false && <SidecarOfflineBanner />}

        <Tabs defaultValue="documents" className="space-y-6">
          <TabsList>
            <TabsTrigger value="documents">Documents</TabsTrigger>
            <TabsTrigger value="web">Web search</TabsTrigger>
          </TabsList>

          <TabsContent value="documents" className="space-y-6">
            <section className="space-y-2">
              <h2 className="text-2xl font-bold tracking-tight text-foreground">
                Documents
              </h2>
              <p className="text-sm text-muted-foreground">
                Upload files to embed them into your local ChromaDB. The assistant will
                use this library to answer questions in v2.
              </p>
            </section>
            <DocumentUploader onUploaded={() => setRefreshKey((k) => k + 1)} />
            <DocumentList refreshKey={refreshKey} />
          </TabsContent>

          <TabsContent value="web">
            <WebSearchPanel />
          </TabsContent>
        </Tabs>
      </main>

    </div>
  );
}

function SidecarBadge({ online }: { online: boolean | null }) {
  if (online === null)
    return (
      <span className="text-xs text-muted-foreground">Checking sidecar…</span>
    );
  return online ? (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-green-500/10 px-2.5 py-1 text-xs font-medium text-green-700 dark:text-green-400">
      <CheckCircle2 className="h-3.5 w-3.5" />
      Sidecar online
    </span>
  ) : (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-destructive/10 px-2.5 py-1 text-xs font-medium text-destructive">
      <AlertCircle className="h-3.5 w-3.5" />
      Sidecar offline
    </span>
  );
}

function SidecarOfflineBanner() {
  const cmd = "cd docker && docker compose up -d";
  return (
    <div className="rounded-lg border border-destructive/50 bg-destructive/5 p-4">
      <div className="flex items-start gap-3">
        <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
        <div className="flex-1 space-y-2">
          <p className="font-medium text-foreground">Sidecar offline</p>
          <p className="text-sm text-muted-foreground">
            The ingest API at{" "}
            <code className="rounded bg-muted px-1 py-0.5 text-xs">{ingestUrl}</code>{" "}
            isn't reachable. Start the local Docker stack:
          </p>
          <div className="flex items-center gap-2 rounded-md bg-muted p-2">
            <code className="flex-1 text-xs">{cmd}</code>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void navigator.clipboard.writeText(cmd)}
            >
              <Copy className="mr-1 h-3.5 w-3.5" />
              Copy
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            See <code>README.md</code> for setup details.
          </p>
        </div>
      </div>
    </div>
  );
}
