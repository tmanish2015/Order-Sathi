import { supabase } from './supabase'

interface ReportableError {
  message: string
}

// Every failed mutation goes through here: shown to the user via toast,
// logged to the console, and best-effort persisted to client_error_log so
// failures survive the tab closing. Never let a logging failure mask the
// original error — the DB insert is fire-and-forget.
export function reportError(
  showError: (message: string) => void,
  context: string,
  error: ReportableError,
  organizationId?: string | null,
  userId?: string | null
) {
  const message = error.message || 'Unknown error'
  console.error(`[${context}]`, message)
  showError(`${context} failed: ${message}`)

  if (organizationId) {
    supabase
      .from('client_error_log')
      .insert({ organization_id: organizationId, user_id: userId ?? null, context, message })
      .then(({ error: logError }) => {
        if (logError) console.error('[client_error_log]', logError.message)
      })
  }
}
