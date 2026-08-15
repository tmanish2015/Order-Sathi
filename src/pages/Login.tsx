import { useState, useEffect, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { useToast } from '../lib/Toast'

export default function Login() {
  const { user, loading } = useAuth()
  const navigate = useNavigate()
  const { showError } = useToast()
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [fullName, setFullName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // A successful sign-in updates `user` via AuthContext's onAuthStateChange
  // listener, but nothing about that navigates away from /login on its own -
  // without this, the form just sits there looking like nothing happened.
  useEffect(() => {
    if (!loading && user) navigate('/', { replace: true })
  }, [user, loading, navigate])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setInfo(null)
    setBusy(true)
    if (mode === 'signin') {
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      setBusy(false)
      if (error) setError(error.message)
      // on success, the useEffect above handles navigation once `user` updates
    } else {
      const { data, error } = await supabase.auth.signUp({ email, password, options: { data: { full_name: fullName } } })
      setBusy(false)
      if (error) {
        setError(error.message)
      } else if (!data.session) {
        // email confirmation required - no session yet, nothing to redirect to
        setInfo('Account created. Check your email to confirm before signing in.')
      }
    }
  }

  async function handleGoogle() {
    const { error } = await supabase.auth.signInWithOAuth({ provider: 'google' })
    if (error) showError(`Google sign-in failed: ${error.message}`)
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <div className="w-full max-w-sm bg-white p-8 rounded-xl shadow-sm border border-slate-200">
        <h1 className="text-xl font-semibold text-slate-900 mb-1">INSIGNIA Control Centre</h1>
        <p className="text-sm text-slate-500 mb-6">
          {mode === 'signin' ? 'Sign in to your account' : 'Create an account'}
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          {mode === 'signup' && (
            <input
              type="text"
              placeholder="Full name"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          )}
          <input
            type="email"
            required
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          <input
            type="password"
            required
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          {error && <p className="text-sm text-red-600">{error}</p>}
          {info && <p className="text-sm text-emerald-600">{info}</p>}
          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-lg bg-indigo-600 text-white py-2 text-sm font-medium hover:bg-indigo-700 disabled:opacity-50"
          >
            {mode === 'signin' ? 'Sign in' : 'Sign up'}
          </button>
        </form>

        <button
          onClick={handleGoogle}
          className="mt-3 w-full rounded-lg border border-slate-300 py-2 text-sm font-medium hover:bg-slate-50 text-slate-400"
          title="Integration pending: Google provider not yet enabled"
        >
          Continue with Google (pending setup)
        </button>

        <button
          onClick={() => setMode(mode === 'signin' ? 'signup' : 'signin')}
          className="mt-4 text-sm text-indigo-600 hover:underline w-full text-center"
        >
          {mode === 'signin' ? "Don't have an account? Sign up" : 'Already have an account? Sign in'}
        </button>
      </div>
    </div>
  )
}
