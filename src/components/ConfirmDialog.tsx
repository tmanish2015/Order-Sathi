interface ConfirmDialogProps {
  title: string
  message: string
  confirmLabel?: string
  danger?: boolean
  busy?: boolean
  onConfirm: () => void
  onCancel: () => void
}

export default function ConfirmDialog({ title, message, confirmLabel = 'Confirm', danger, busy, onConfirm, onCancel }: ConfirmDialogProps) {
  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/30 p-4" onClick={onCancel}>
      <div className="bg-white rounded-xl shadow-xl border border-slate-200 max-w-sm w-full p-5" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-sm font-semibold text-slate-900 mb-1.5">{title}</h3>
        <p className="text-sm text-slate-500 mb-4">{message}</p>
        <div className="flex justify-end gap-2">
          <button onClick={onCancel} className="text-sm rounded-lg border border-slate-300 px-3 py-1.5 hover:bg-slate-50">
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={busy}
            className={`text-sm rounded-lg px-3 py-1.5 text-white disabled:opacity-50 ${
              danger ? 'bg-red-600 hover:bg-red-700' : 'bg-indigo-600 hover:bg-indigo-700'
            }`}
          >
            {busy ? 'Working…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
