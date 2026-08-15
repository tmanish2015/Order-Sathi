import { useState } from 'react'
import { NavLink, Outlet, Navigate } from 'react-router-dom'
import { useAuth } from '../lib/AuthContext'

const NAV = [
  { to: '/', label: 'Dashboard', icon: '📊', roles: ['admin', 'sales', 'marketing', 'finance'] },
  { to: '/attention', label: 'Attention', icon: '⚡', roles: ['admin', 'sales', 'marketing', 'finance'] },
  { to: '/customers', label: 'Customers', icon: '🏢', roles: ['admin', 'sales', 'finance'] },
  { to: '/renewals', label: 'Renewals', icon: '🔄', roles: ['admin', 'sales', 'finance'] },
  { to: '/billing', label: 'Billing', icon: '💳', roles: ['admin', 'finance'] },
  { to: '/opportunities', label: 'Opportunities', icon: '📈', roles: ['admin', 'sales', 'marketing'] },
  { to: '/tasks', label: 'Tasks', icon: '✅', roles: ['admin', 'sales', 'marketing', 'finance'] },
  { to: '/leads', label: 'Leads', icon: '🎯', roles: ['admin', 'sales', 'marketing'] },
  { to: '/campaigns', label: 'Campaigns', icon: '📣', roles: ['admin', 'marketing'] },
  { to: '/studio', label: 'Creative Studio', icon: '🎨', roles: ['admin', 'sales', 'marketing'] },
  { to: '/video-maker', label: 'Video Maker', icon: '🎬', roles: ['admin', 'sales', 'marketing'] },
  { to: '/integrations', label: 'Integrations', icon: '🔌', roles: ['admin', 'sales', 'marketing', 'finance'] },
  { to: '/team', label: 'Team', icon: '👥', roles: ['admin'] },
]

export default function Layout() {
  const { user, profile, loading, signOut } = useAuth()
  const [drawerOpen, setDrawerOpen] = useState(false)

  if (loading) return <div className="min-h-screen flex items-center justify-center text-slate-400">Loading…</div>
  if (!user) return <Navigate to="/login" replace />

  if (profile?.status === 'pending') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
        <div className="max-w-sm text-center">
          <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-indigo-400 to-purple-500 flex items-center justify-center text-sm font-bold text-white mx-auto mb-4">
            I
          </div>
          <h1 className="text-lg font-semibold text-slate-900 mb-1">Awaiting approval</h1>
          <p className="text-sm text-slate-500">
            Your account ({user.email}) has been created but hasn't been approved by an admin yet. You'll get
            access as soon as someone on the team approves your account and assigns your role.
          </p>
          <button onClick={signOut} className="mt-6 text-sm text-indigo-600 hover:underline">
            Sign out
          </button>
        </div>
      </div>
    )
  }

  const role = profile?.role ?? 'sales'
  const visible = NAV.filter((n) => n.roles.includes(role))

  const sidebarContent = (
    <>
      <div className="px-5 py-6 border-b border-white/10">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-400 to-purple-500 flex items-center justify-center text-sm font-bold text-white shrink-0">
            I
          </div>
          <div>
            <h1 className="text-sm font-semibold text-white tracking-wide">INSIGNIA</h1>
            <p className="text-[10px] text-indigo-200/70 -mt-0.5">Control Centre</p>
          </div>
        </div>
        <p className="text-xs text-slate-300 mt-3 truncate">{profile?.full_name || profile?.email}</p>
        <span className="inline-block mt-1 text-[10px] uppercase tracking-wide bg-white/10 text-indigo-200 rounded px-1.5 py-0.5">
          {role}
        </span>
      </div>
      <nav className="flex-1 px-2 py-3 space-y-0.5 overflow-y-auto">
        {visible.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            onClick={() => setDrawerOpen(false)}
            className={({ isActive }) =>
              `flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                isActive ? 'bg-white/10 text-white' : 'text-slate-300 hover:bg-white/5 hover:text-white'
              }`
            }
          >
            <span className="text-base leading-none">{item.icon}</span>
            {item.label}
          </NavLink>
        ))}
      </nav>
      <div className="px-2 py-3 border-t border-white/10">
        <button
          onClick={signOut}
          className="w-full text-left rounded-lg px-3 py-2 text-sm text-slate-300 hover:bg-white/5 hover:text-white"
        >
          Sign out
        </button>
      </div>
    </>
  )

  return (
    <div className="min-h-screen flex bg-slate-50">
      {/* Desktop sidebar */}
      <aside className="hidden lg:flex lg:w-60 lg:flex-col bg-gradient-to-b from-slate-900 to-slate-800 shrink-0">
        {sidebarContent}
      </aside>

      {/* Mobile drawer */}
      {drawerOpen && (
        <div className="lg:hidden fixed inset-0 z-40 flex">
          <div className="absolute inset-0 bg-black/40" onClick={() => setDrawerOpen(false)} />
          <aside className="relative z-50 w-64 flex flex-col bg-gradient-to-b from-slate-900 to-slate-800">
            {sidebarContent}
          </aside>
        </div>
      )}

      <div className="flex-1 flex flex-col min-w-0">
        {/* Mobile topbar */}
        <div className="lg:hidden flex items-center gap-3 px-4 py-3 bg-white border-b border-slate-200 sticky top-0 z-30">
          <button
            onClick={() => setDrawerOpen(true)}
            className="text-slate-600 p-1 -ml-1"
            aria-label="Open menu"
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 6h18M3 12h18M3 18h18" strokeLinecap="round" />
            </svg>
          </button>
          <span className="text-sm font-semibold text-slate-900">INSIGNIA</span>
        </div>

        <main className="flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
