import { useState } from "react";
import { Search, Loader2, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { webSearch, type WebSearchResult } from "@/lib/ingest-client";

export function WebSearchPanel() {
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<WebSearchResult[]>([]);
  const [answers, setAnswers] = useState<string[]>([]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const res = await webSearch(query.trim(), { maxResults: 10 });
      setResults(res.results);
      setAnswers(res.answers);
    } catch (e) {
      setError((e as Error).message);
      setResults([]);
      setAnswers([]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold text-foreground">Web search</h2>
        <p className="text-sm text-muted-foreground">
          Privacy-respecting metasearch via your local SearXNG. The assistant will use
          this as a tool in v2.
        </p>
      </div>

      <form onSubmit={onSubmit} className="flex gap-2">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search the web…"
          className="flex-1"
        />
        <Button type="submit" disabled={loading || !query.trim()}>
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Search className="h-4 w-4" />
          )}
        </Button>
      </form>

      {error && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {answers.length > 0 && (
        <div className="rounded-md border border-primary/30 bg-primary/5 p-3">
          <p className="mb-1 text-xs font-medium uppercase tracking-wide text-primary">
            Quick answer
          </p>
          {answers.map((a, i) => (
            <p key={i} className="text-sm text-foreground">
              {a}
            </p>
          ))}
        </div>
      )}

      {results.length > 0 && (
        <ul className="space-y-3">
          {results.map((r, i) => (
            <li key={`${r.url}-${i}`} className="rounded-md border border-border p-3">
              <a
                href={r.url}
                target="_blank"
                rel="noopener noreferrer"
                className="group flex items-start gap-1.5"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-primary group-hover:underline">
                    {r.title || r.url}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">{r.url}</p>
                  {r.content && (
                    <p className="mt-1 line-clamp-2 text-sm text-foreground">
                      {r.content}
                    </p>
                  )}
                  {r.engine && (
                    <p className="mt-1 text-xs text-muted-foreground">via {r.engine}</p>
                  )}
                </div>
                <ExternalLink className="mt-1 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
