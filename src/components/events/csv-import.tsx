"use client";

import { useRef, useState } from "react";
import { importEventsFromCSV, type ImportResult } from "@/app/actions/events";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Upload,
  FileText,
  X,
  CheckCircle2,
  AlertCircle,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  orgId: string;
  onImported: () => void;
}

// Simple client-side CSV preview parser (first N rows only)
function previewCSV(text: string, maxRows = 5) {
  const lines = text.split("\n").filter((l) => l.trim());
  if (lines.length < 2) return null;
  const split = (line: string) =>
    line.split(",").map((v) => v.trim().replace(/^"|"$/g, ""));
  const headers = split(lines[0]);
  const rows = lines.slice(1, maxRows + 1).map(split);
  const total = lines.length - 1;
  return { headers, rows, total };
}

export function CsvImport({ orgId, onImported }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ReturnType<typeof previewCSV>>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);

  function handleFile(f: File) {
    if (!f.name.endsWith(".csv")) {
      alert("Please upload a .csv file.");
      return;
    }
    setFile(f);
    setResult(null);
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      setPreview(previewCSV(text));
    };
    reader.readAsText(f);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files[0];
    if (f) handleFile(f);
  }

  function clear() {
    setFile(null);
    setPreview(null);
    setResult(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  async function handleImport() {
    if (!file) return;
    setLoading(true);
    const text = await file.text();
    const res = await importEventsFromCSV(orgId, text);
    setResult(res);
    setLoading(false);
    if (res.imported > 0) onImported();
  }

  return (
    <div className="space-y-4">
      {/* Drop zone */}
      {!file && (
        <div
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          onClick={() => inputRef.current?.click()}
          className={cn(
            "flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed p-12 cursor-pointer transition-colors",
            dragging
              ? "border-blue-500 bg-blue-500/5"
              : "border-border hover:border-blue-400 hover:bg-muted/40"
          )}
        >
          <Upload className="h-8 w-8 text-muted-foreground" />
          <div className="text-center">
            <p className="text-sm font-medium">
              Drop a CSV file here, or click to browse
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Needs a <code className="bg-muted px-1 rounded">name</code> column.
              Optional: <code className="bg-muted px-1 rounded">timestamp</code>,{" "}
              <code className="bg-muted px-1 rounded">user_id</code>,{" "}
              <code className="bg-muted px-1 rounded">session_id</code>. All other columns become event properties.
            </p>
          </div>
          <input
            ref={inputRef}
            type="file"
            accept=".csv"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
          />
        </div>
      )}

      {/* File selected */}
      {file && (
        <div className="flex items-center justify-between rounded-lg border bg-muted/30 px-4 py-3">
          <div className="flex items-center gap-3">
            <FileText className="h-5 w-5 text-blue-500 shrink-0" />
            <div>
              <p className="text-sm font-medium">{file.name}</p>
              <p className="text-xs text-muted-foreground">
                {(file.size / 1024).toFixed(1)} KB
                {preview ? ` · ${preview.total.toLocaleString()} rows` : ""}
              </p>
            </div>
          </div>
          <button onClick={clear} className="text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Preview table */}
      {preview && !result && (
        <Card>
          <CardContent className="p-0 overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b bg-muted/50">
                  {preview.headers.map((h) => (
                    <th key={h} className="px-3 py-2 text-left font-medium text-muted-foreground whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((row, i) => (
                  <tr key={i} className="border-b last:border-0">
                    {row.map((cell, j) => (
                      <td key={j} className="px-3 py-2 text-foreground whitespace-nowrap max-w-[160px] truncate">
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            {preview.total > 5 && (
              <p className="px-3 py-2 text-xs text-muted-foreground border-t">
                Showing 5 of {preview.total.toLocaleString()} rows
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Result */}
      {result && (
        <div className={cn(
          "rounded-lg border px-4 py-3 space-y-1",
          result.errors.length === 0
            ? "border-green-500/30 bg-green-500/5"
            : "border-amber-500/30 bg-amber-500/5"
        )}>
          <div className="flex items-center gap-2">
            {result.errors.length === 0
              ? <CheckCircle2 className="h-4 w-4 text-green-500" />
              : <AlertCircle className="h-4 w-4 text-amber-500" />}
            <p className="text-sm font-medium">
              {result.imported.toLocaleString()} events imported
              {result.skipped > 0 ? `, ${result.skipped} skipped` : ""}
            </p>
          </div>
          {result.errors.map((e, i) => (
            <p key={i} className="text-xs text-destructive pl-6">{e}</p>
          ))}
        </div>
      )}

      {/* Actions */}
      {file && !result && (
        <div className="flex gap-2">
          <Button
            onClick={handleImport}
            disabled={loading}
            className="bg-blue-600 hover:bg-blue-700 text-white"
          >
            {loading ? (
              <><Loader2 className="h-4 w-4 animate-spin" /> Importing…</>
            ) : (
              <>Import {preview ? `${preview.total.toLocaleString()} events` : "events"}</>
            )}
          </Button>
          <Button variant="outline" onClick={clear} disabled={loading}>
            Cancel
          </Button>
        </div>
      )}

      {result && result.imported > 0 && (
        <Button variant="outline" onClick={clear}>
          Import another file
        </Button>
      )}
    </div>
  );
}
