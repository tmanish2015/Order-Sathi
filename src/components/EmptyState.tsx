import type { ReactNode } from 'react'

export default function EmptyState({ icon = '📭', title, action }: { icon?: string; title: string; action?: ReactNode }) {
  return (
    <div className="px-4 py-10 text-center">
      <div className="text-3xl mb-2">{icon}</div>
      <p className="text-sm text-slate-400 dark:text-slate-500">{title}</p>
      {action && <div className="mt-3">{action}</div>}
    </div>
  )
}
