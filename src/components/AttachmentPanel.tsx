"use client";

// Receipt attachments for a single transaction. Drops into the transaction
// details modal. Lists existing attachments (image thumbnails or file chips),
// each opening inline (/api/attachments/{id}) with a delete button, plus an
// upload control that reads a file as base64 and POSTs it.
//
// It manages its own list state (independent of the server render) so uploads
// and deletes feel instant without a full router.refresh().
import { useCallback, useEffect, useRef, useState } from "react";
import { clsx } from "clsx";
import { Loader2, Paperclip, Trash2, Upload, FileText, ImageIcon } from "lucide-react";

export interface AttachmentMeta {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
}

/** e.g. 12345 -> "12 KB", 4_500_000 -> "4.3 MB". */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Read a File as raw base64 (without the `data:...;base64,` prefix). */
function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? "");
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error ?? new Error("Could not read file"));
    reader.readAsDataURL(file);
  });
}

export function AttachmentPanel({
  transactionId,
  initial,
}: {
  transactionId: string;
  initial?: AttachmentMeta[];
}) {
  const [items, setItems] = useState<AttachmentMeta[]>(initial ?? []);
  const [loading, setLoading] = useState(!initial);
  const [uploading, setUploading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    const res = await fetch(`/api/transactions/${transactionId}/attachments`).catch(() => null);
    if (!res || !res.ok) return;
    const data = (await res.json().catch(() => ({}))) as { attachments?: AttachmentMeta[] };
    setItems(data.attachments ?? []);
  }, [transactionId]);

  // Fetch the list on mount unless the caller pre-seeded it.
  useEffect(() => {
    if (initial) return;
    let active = true;
    (async () => {
      await refresh();
      if (active) setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [initial, refresh]);

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    // Reset the input so picking the same file again still fires onChange.
    if (fileRef.current) fileRef.current.value = "";
    if (!file) return;

    setError("");
    const isAllowed = file.type.startsWith("image/") || file.type === "application/pdf";
    if (!isAllowed) {
      setError("Only images or PDF files can be attached.");
      return;
    }
    if (file.size > 4 * 1024 * 1024) {
      setError("That file is too large. Attachments must be 4 MB or smaller.");
      return;
    }

    setUploading(true);
    try {
      const dataBase64 = await readAsBase64(file);
      const res = await fetch(`/api/transactions/${transactionId}/attachments`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ filename: file.name, mimeType: file.type, dataBase64 }),
      });
      if (!res.ok) {
        const msg = ((await res.json().catch(() => ({}))) as { error?: string }).error;
        setError(msg || "Upload failed. Please try again.");
      } else {
        await refresh();
      }
    } catch {
      setError("Could not read that file. Please try again.");
    } finally {
      setUploading(false);
    }
  }

  async function onDelete(id: string) {
    setError("");
    setBusyId(id);
    const res = await fetch(`/api/attachments/${id}`, { method: "DELETE" }).catch(() => null);
    setBusyId(null);
    if (!res || !res.ok) {
      setError("Couldn't remove that attachment.");
      return;
    }
    setItems((prev) => prev.filter((a) => a.id !== id));
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-sm font-medium">
          <Paperclip size={14} className="muted" />
          Receipts
          {items.length > 0 && <span className="muted font-normal">({items.length})</span>}
        </div>
        <label
          className={clsx("btn-ghost cursor-pointer text-xs", uploading && "pointer-events-none opacity-60")}
        >
          {uploading ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
          {uploading ? "Uploading…" : "Add file"}
          <input
            ref={fileRef}
            type="file"
            accept="image/*,application/pdf"
            className="hidden"
            onChange={onPick}
            disabled={uploading}
          />
        </label>
      </div>

      {error && <p className="text-xs text-rose-500">{error}</p>}

      {loading ? (
        <div className="muted flex items-center gap-2 py-4 text-xs">
          <Loader2 size={14} className="animate-spin" /> Loading…
        </div>
      ) : items.length === 0 ? (
        <p className="muted rounded-xl border border-dashed px-3 py-4 text-center text-xs" style={{ borderColor: "var(--border)" }}>
          No receipts yet. Attach an image or PDF to keep it with this transaction.
        </p>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {items.map((a) => {
            const isImage = a.mimeType.startsWith("image/");
            const href = `/api/attachments/${a.id}`;
            const deleting = busyId === a.id;
            return (
              <li
                key={a.id}
                className="group relative flex items-center gap-2 rounded-xl border p-2"
                style={{ borderColor: "var(--border)" }}
              >
                <a
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 no-underline"
                  title={`${a.filename} · ${formatBytes(a.sizeBytes)}`}
                >
                  {isImage ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={href}
                      alt={a.filename}
                      className="h-10 w-10 shrink-0 rounded-lg object-cover"
                    />
                  ) : (
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-black/5 dark:bg-white/10">
                      {a.mimeType === "application/pdf" ? (
                        <FileText size={16} className="muted" />
                      ) : (
                        <ImageIcon size={16} className="muted" />
                      )}
                    </span>
                  )}
                  <span className="max-w-[9rem] min-w-0">
                    <span className="block truncate text-xs font-medium">{a.filename}</span>
                    <span className="muted block text-[11px]">{formatBytes(a.sizeBytes)}</span>
                  </span>
                </a>
                <button
                  type="button"
                  onClick={() => onDelete(a.id)}
                  disabled={deleting}
                  aria-label={`Remove ${a.filename}`}
                  className="muted grid h-7 w-7 shrink-0 place-items-center rounded-lg transition hover:bg-rose-500/10 hover:text-rose-500"
                >
                  {deleting ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export default AttachmentPanel;
