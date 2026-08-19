export default function Skeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="divide-y divide-slate-50">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="px-4 py-3 animate-pulse">
          <div className="h-3.5 bg-slate-100 dark:bg-slate-700/60 rounded w-2/3 mb-2" />
          <div className="h-3 bg-slate-100 dark:bg-slate-700/60 rounded w-1/3" />
        </div>
      ))}
    </div>
  )
}
