import { useEffect, useState } from 'react'
import { NavLink, Outlet, Navigate } from 'react-router-dom'
import { useAuth } from '../lib/AuthContext'
import { supabase } from '../lib/supabase'
import GlobalSearch from './GlobalSearch'

const NAV = [
  { to: '/', label: 'Dashboard', icon: '📊', roles: ['admin', 'ops', 'finance'] },
  { to: '/notifications', label: 'Notifications', icon: '🔔', roles: ['admin', 'ops', 'finance'] },
  { to: '/orders', label: 'Orders', icon: '📦', roles: ['admin', 'ops', 'finance'] },
  { to: '/inventory', label: 'Inventory', icon: '📋', roles: ['admin', 'ops', 'finance'] },
  { to: '/sku-mapping', label: 'SKU Mapping', icon: '🔗', roles: ['admin', 'ops'] },
  { to: '/warehouses', label: 'Warehouses', icon: '🏭', roles: ['admin', 'ops'] },
  { to: '/grn', label: 'GRN / Inward', icon: '📦', roles: ['admin', 'ops'] },
  { to: '/putaway', label: 'Put-away', icon: '📥', roles: ['admin', 'ops'] },
  { to: '/stock-transfer', label: 'Stock Transfers', icon: '🔀', roles: ['admin', 'ops'] },
  { to: '/cycle-count', label: 'Cycle Count', icon: '🔍', roles: ['admin', 'ops'] },
  { to: '/batch-serial', label: 'Batch / Serial', icon: '🏷', roles: ['admin', 'ops'] },
  { to: '/pricing', label: 'Pricing', icon: '💰', roles: ['admin', 'ops', 'finance'] },
  { to: '/promotions', label: 'Promotions', icon: '🏷', roles: ['admin', 'ops'] },
  { to: '/automation', label: 'Automation', icon: '⚡', roles: ['admin', 'ops'] },
  { to: '/customers', label: 'Customers', icon: '👤', roles: ['admin', 'ops', 'finance'] },
  { to: '/forecast', label: 'Forecast', icon: '📈', roles: ['admin', 'ops'] },
  { to: '/picklist', label: 'Picklists', icon: '🧾', roles: ['admin', 'ops'] },
  { to: '/packing', label: 'Packing', icon: '📦', roles: ['admin', 'ops'] },
  { to: '/shipping', label: 'Shipping', icon: '🚚', roles: ['admin', 'ops'] },
  { to: '/ndr', label: 'NDR', icon: '⚠️', roles: ['admin', 'ops'] },
  { to: '/invoices', label: 'GST Invoices', icon: '🧾', roles: ['admin', 'finance'] },
  { to: '/reconciliation', label: 'Reconciliation', icon: '🔄', roles: ['admin', 'finance'] },
  { to: '/returns', label: 'Returns & RTO', icon: '↩️', roles: ['admin', 'ops', 'finance'] },
  { to: '/profit', label: 'Profit & Loss', icon: '📊', roles: ['admin', 'finance'] },
  { to: '/reports', label: 'Reports & Analytics', icon: '📈', roles: ['admin', 'ops', 'finance'] },
  { to: '/sync-logs', label: 'Sync Logs', icon: '📡', roles: ['admin', 'ops', 'finance'] },
  { to: '/audit-log', label: 'Audit Log', icon: '📜', roles: ['admin', 'finance'] },
  { to: '/integrations', label: 'Integrations', icon: '🔌', roles: ['admin', 'finance'] },
  { to: '/accounting', label: 'Accounting', icon: '📒', roles: ['admin', 'finance'] },
  { to: '/exports', label: 'Exports', icon: '📤', roles: ['admin', 'ops', 'finance'] },
  { to: '/imports', label: 'Imports', icon: '📥', roles: ['admin', 'ops'] },
  { to: '/team', label: 'Team', icon: '👥', roles: ['admin'] },
]

export default function Layout() {
  const { user, profile, loading, signOut } = useAuth()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [unreadCount, setUnreadCount] = useState(0)

  useEffect(() => {
    if (!profile?.organization_id) return
    supabase
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('read', false)
      .then(({ count }) => setUnreadCount(count ?? 0))
  }, [profile?.organization_id])

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

  const role = profile?.role ?? 'ops'
  const visible = NAV.filter((n) => n.roles.includes(role))

  const sidebarContent = (
    <>
      <div className="px-5 py-6 border-b border-white/10">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-400 to-purple-500 flex items-center justify-center text-sm font-bold text-white shrink-0">
            I
          </div>
          <div>
            <h1 className="text-sm font-semibold text-white tracking-wide">Order Sathi</h1>
            <p className="text-[10px] text-indigo-200/70 -mt-0.5">Amazon OMS</p>
          </div>
        </div>
        <p className="text-xs text-slate-300 mt-3 truncate">{profile?.full_name || profile?.email}</p>
        <span className="inline-block mt-1 text-[10px] uppercase tracking-wide bg-white/10 text-indigo-200 rounded px-1.5 py-0.5">
          {role}
        </span>
      </div>
      <div className="px-2 pt-3">
        <GlobalSearch onNavigate={() => setDrawerOpen(false)} />
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
            {item.to === '/notifications' && unreadCount > 0 && (
              <span className="ml-auto text-[10px] font-semibold bg-red-500 text-white rounded-full px-1.5 py-0.5 leading-none">{unreadCount}</span>
            )}
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
          <span className="text-sm font-semibold text-slate-900">Order Sathi</span>
        </div>

        <main className="flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
