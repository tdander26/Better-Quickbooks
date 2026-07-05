// Shown while a route's server data loads. Renders inside the app shell, so it's
// just a lightweight content skeleton.
export default function Loading() {
  return (
    <div className="animate-pulse space-y-4">
      <div className="h-8 w-48 rounded-lg bg-black/5 dark:bg-white/10" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="card h-24" />
        ))}
      </div>
      <div className="card h-64" />
      <div className="card h-48" />
    </div>
  );
}
