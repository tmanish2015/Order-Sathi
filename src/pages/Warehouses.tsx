import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { useToast } from '../lib/Toast'
import { reportError } from '../lib/errors'
import ConfirmDialog from '../components/ConfirmDialog'
import Skeleton from '../components/Skeleton'
import EmptyState from '../components/EmptyState'
import type { Tables } from '../lib/database.types'

type Warehouse = Tables<'warehouses'>

export default function Warehouses() {
  const { profile } = useAuth()
  const { showError, showSuccess } = useToast()
  const [warehouses, setWarehouses] = useState<Warehouse[]>([])
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [newWarehouse, setNewWarehouse] = useState({ name: '', address: '' })
  const [saving, setSaving] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<Warehouse | null>(null)
  const [deleting, setDeleting] = useState(false)
  const orgId = profile?.organization_id
  const isAdmin = profile?.role === 'admin'

  async function load() {
    if (!orgId) return
    setLoading(true)
    const { data } = await supabase.from('warehouses').select('*').order('name')
    setWarehouses(data ?? [])
    setLoading(false)
  }

  useEffect(() => {
    load()
  }, [orgId])

  async function addWarehouse() {
    if (!orgId || !newWarehouse.name.trim()) {
      showError('Name is required.')
      return
    }
    setSaving(true)
    const { error } = await supabase.from('warehouses').insert({
      organization_id: orgId,
      name: newWarehouse.name.trim(),
      address: newWarehouse.address || null,
    })
    setSaving(false)
    if (error) {
      reportError(showError, 'Add warehouse', error, orgId, profile?.id)
      return
    }
    showSuccess(`Warehouse "${newWarehouse.name}" added.`)
    setNewWarehouse({ name: '', address: '' })
    setShowAdd(false)
    load()
  }

  async function makeDefault(w: Warehouse) {
    await supabase.from('warehouses').update({ is_default: false }).eq('organization_id', orgId!)
    const { error } = await supabase.from('warehouses').update({ is_default: true }).eq('id', w.id)
    if (error) {
      reportError(showError, 'Set default warehouse', error, orgId, profile?.id)
      return
    }
    load()
  }

  async function confirmDelete() {
    if (!deleteTarget) return
    setDeleting(true)
    const { error } = await supabase.from('warehouses').delete().eq('id', deleteTarget.id)
    setDeleting(false)
    setDeleteTarget(null)
    if (error) {
      reportError(showError, 'Delete warehouse', error, orgId, profile?.id)
      return
    }
    showSuccess(`Warehouse "${deleteTarget.name}" deleted.`)
    load()
  }

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-1">
        <h2 className="text-lg font-semibold text-slate-900">Warehouses</h2>
        {isAdmin && (
          <button onClick={() => setShowAdd((v) => !v)} className="text-sm rounded-lg border border-slate-300 px-3 py-1.5 hover:bg-slate-50">
            {showAdd ? 'Cancel' : '+ Add warehouse'}
          </button>
        )}
      </div>
      <p className="text-xs text-slate-400 mb-6">
        Every stock movement belongs to one warehouse. The default warehouse is used whenever an order or adjustment doesn't specify one.
      </p>

      {showAdd && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 mb-6 grid grid-cols-1 sm:grid-cols-2 gap-3 items-end">
          <label className="block">
            <span className="text-xs text-slate-500">Name</span>
            <input
              type="text"
              value={newWarehouse.name}
              onChange={(e) => setNewWarehouse((f) => ({ ...f, name: e.target.value }))}
              placeholder="e.g. Jaipur Warehouse"
              className="mt-1 w-full text-sm rounded-lg border border-slate-300 px-2.5 py-1.5"
            />
          </label>
          <label className="block">
            <span className="text-xs text-slate-500">Address</span>
            <input
              type="text"
              value={newWarehouse.address}
              onChange={(e) => setNewWarehouse((f) => ({ ...f, address: e.target.value }))}
              className="mt-1 w-full text-sm rounded-lg border border-slate-300 px-2.5 py-1.5"
            />
          </label>
          <div className="sm:col-span-2">
            <button onClick={addWarehouse} disabled={saving} className="text-sm rounded-lg bg-indigo-600 text-white px-3 py-1.5 hover:bg-indigo-700 disabled:opacity-50">
              {saving ? 'Saving…' : 'Add warehouse'}
            </button>
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        {loading ? (
          <Skeleton rows={2} />
        ) : warehouses.length === 0 ? (
          <EmptyState icon="🏭" title="No warehouses yet." />
        ) : (
          <div className="divide-y divide-slate-50">
            {warehouses.map((w) => (
              <div key={w.id} className="px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
                <div>
                  <div className="font-medium text-sm text-slate-900 flex items-center gap-2">
                    {w.name}
                    {w.is_default && <span className="text-[10px] uppercase tracking-wide bg-indigo-50 text-indigo-600 rounded px-1.5 py-0.5">Default</span>}
                  </div>
                  {w.address && <div className="text-xs text-slate-400">{w.address}</div>}
                </div>
                {isAdmin && (
                  <div className="flex items-center gap-3">
                    {!w.is_default && (
                      <button onClick={() => makeDefault(w)} className="text-xs font-medium text-indigo-600 hover:text-indigo-700">
                        Make default
                      </button>
                    )}
                    <button onClick={() => setDeleteTarget(w)} className="text-xs text-slate-400 hover:text-red-600">
                      Delete
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {deleteTarget && (
        <ConfirmDialog
          title="Delete warehouse?"
          message={`Delete "${deleteTarget.name}"? Fails if any stock movement references it.`}
          confirmLabel="Delete"
          danger
          busy={deleting}
          onConfirm={confirmDelete}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </div>
  )
}
