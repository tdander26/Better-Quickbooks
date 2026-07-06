"use client";

// Route error boundary — replaces the blank/hung page when a server component or
// data fetch throws. Offers a retry.
import { useEffect } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="grid min-h-[60vh] place-items-center px-4">
      <div className="card max-w-md p-8 text-center">
        <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-rose-500/15 text-rose-600 dark:text-rose-400">
          <AlertTriangle size={24} />
        </div>
        <h1 className="text-lg font-semibold">Something went wrong</h1>
        <p className="muted mt-1 text-sm">
          This screen hit an error while loading. It&apos;s usually temporary.
        </p>
        {error?.digest && (
          <p className="muted mt-2 font-mono text-xs">Reference: {error.digest}</p>
        )}
        {error?.message && !/omitted in production/i.test(error.message) && (
          <p className="mt-3 break-words rounded-lg bg-black/5 px-3 py-2 text-left font-mono text-xs text-rose-700 dark:bg-white/10 dark:text-rose-300">
            {error.message.slice(0, 300)}
          </p>
        )}
        <button className="btn-primary mx-auto mt-5" onClick={reset}>
          <RotateCcw size={16} />
          Try again
        </button>
      </div>
    </div>
  );
}
