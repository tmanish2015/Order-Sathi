import { useRef, useState } from 'react'

// Handheld USB/Bluetooth scanners behave like a keyboard: they type the
// barcode fast and send Enter. This input just needs to stay focused and
// submit on Enter - no scanner SDK required. Also works for manual typing
// and, since it's a plain text input, for phone browsers that support
// camera-based barcode input via their own keyboard/autofill.
export default function BarcodeScanInput({
  onScan,
  placeholder = 'Scan or type barcode, then Enter',
  autoFocus = true,
}: {
  onScan: (code: string) => void
  placeholder?: string
  autoFocus?: boolean
}) {
  const [value, setValue] = useState('')
  const ref = useRef<HTMLInputElement>(null)

  function submit() {
    const code = value.trim()
    if (!code) return
    onScan(code)
    setValue('')
    ref.current?.focus()
  }

  return (
    <input
      ref={ref}
      type="text"
      inputMode="text"
      autoFocus={autoFocus}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          submit()
        }
      }}
      placeholder={placeholder}
      className="w-full text-sm rounded-lg border-2 border-indigo-300 focus:border-indigo-500 px-3 py-2 outline-none dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100"
    />
  )
}
