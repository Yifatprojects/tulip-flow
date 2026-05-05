import { useEffect, useRef, useState } from 'react'
import {
  AlertTriangle, CheckCircle, Edit2, Loader2,
  Plus, Save, Search, Trash2, X,
} from 'lucide-react'
import { supabase } from './lib/supabaseClient'

// ── Shared constants ───────────────────────────────────────────────────────────
const EXPENSE_CATEGORY_OPTIONS = ['Media', 'Independent']
const RENTAL_CATEGORY_OPTIONS  = ['Digital', 'Physical', 'TV', 'Other Format', 'Independent']

// ── Tiny shared UI atoms ──────────────────────────────────────────────────────
function TInput({ value, onChange, placeholder, className = '', type = 'text' }) {
  return (
    <input
      type={type}
      value={value ?? ''}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      className={`w-full rounded-lg border border-[rgba(74,20,140,0.2)] bg-white px-2.5 py-1.5 text-sm text-[#4B4594] outline-none transition focus:border-[#4B4594] focus:ring-2 focus:ring-[#4B4594]/20 ${className}`}
    />
  )
}

function TSelect({ value, onChange, options, placeholder }) {
  return (
    <select
      value={value ?? ''}
      onChange={e => onChange(e.target.value)}
      className="w-full rounded-lg border border-[rgba(74,20,140,0.2)] bg-white px-2.5 py-1.5 text-sm text-[#4B4594] outline-none transition focus:border-[#4B4594] focus:ring-2 focus:ring-[#4B4594]/20"
    >
      <option value="">{placeholder ?? 'Select…'}</option>
      {options.map(o => <option key={o} value={o}>{o}</option>)}
    </select>
  )
}

function Toast({ toast }) {
  if (!toast) return null
  const isOk = toast.type === 'success'
  return (
    <div className={`mb-4 flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold ${
      isOk ? 'border border-[rgba(47,163,107,0.3)] bg-[#F0FBF5] text-[#1a7a4e]'
            : 'border border-red-200 bg-red-50 text-red-700'
    }`}>
      {isOk ? <CheckCircle className="h-4 w-4 shrink-0" /> : <AlertTriangle className="h-4 w-4 shrink-0" />}
      {toast.message}
    </div>
  )
}

// ── Expenses Catalog ──────────────────────────────────────────────────────────
function ExpensesCatalog() {
  const [rows, setRows]               = useState([])
  const [loading, setLoading]         = useState(true)
  const [search, setSearch]           = useState('')
  const [editingId, setEditingId]     = useState(null)
  const [draft, setDraft]             = useState({})
  const [saving, setSaving]           = useState(false)
  const [adding, setAdding]           = useState(false)
  const [newRow, setNewRow]           = useState(emptyExpense())
  const [deleteConfirm, setDeleteConfirm] = useState(null) // priority_code to delete
  const [deleting, setDeleting]       = useState(false)
  const [toast, setToast]             = useState(null)

  function emptyExpense() {
    return { priority_code: '', expense_description: '', media_budget_code: '', expense_type: '', reporting_code: '' }
  }

  function showToast(type, message) {
    setToast({ type, message })
    setTimeout(() => setToast(null), 3500)
  }

  async function load() {
    setLoading(true)
    const { data, error } = await supabase
      .from('expenses')
      .select('priority_code, expense_description, media_budget_code, expense_type, reporting_code')
      .order('priority_code')
    if (!error) setRows(data ?? [])
    setLoading(false)
  }

  useEffect(() => { void load() }, [])

  const filtered = rows.filter(r => {
    const q = search.toLowerCase()
    return !q
      || String(r.priority_code ?? '').toLowerCase().includes(q)
      || String(r.expense_description ?? '').toLowerCase().includes(q)
      || String(r.media_budget_code ?? '').toLowerCase().includes(q)
      || String(r.expense_type ?? '').toLowerCase().includes(q)
  })

  function startEdit(row) {
    setEditingId(row.priority_code)
    setDraft({ ...row })
  }

  async function saveEdit() {
    setSaving(true)
    const { error } = await supabase
      .from('expenses')
      .update({
        expense_description: draft.expense_description,
        media_budget_code:   draft.media_budget_code   || null,
        expense_type:        draft.expense_type        || null,
        reporting_code:      draft.reporting_code      || null,
      })
      .eq('priority_code', draft.priority_code)
    setSaving(false)
    if (error) { showToast('error', `Save failed: ${error.message}`); return }
    setRows(prev => prev.map(r => r.priority_code === draft.priority_code ? { ...draft } : r))
    setEditingId(null)
    showToast('success', 'Row updated successfully.')
  }

  async function saveNew() {
    if (!newRow.priority_code.trim() || !newRow.expense_description.trim()) {
      showToast('error', 'Priority Code and Name are required.')
      return
    }
    setSaving(true)
    const { data, error } = await supabase
      .from('expenses')
      .insert([{
        priority_code:       newRow.priority_code.trim(),
        expense_description: newRow.expense_description.trim(),
        media_budget_code:   newRow.media_budget_code   || null,
        expense_type:        newRow.expense_type        || null,
        reporting_code:      newRow.reporting_code      || null,
      }])
      .select()
    setSaving(false)
    if (error) { showToast('error', `Add failed: ${error.message}`); return }
    setRows(prev => [...prev, ...(data ?? [])])
    setNewRow(emptyExpense())
    setAdding(false)
    showToast('success', 'New expense item added.')
  }

  async function confirmDelete() {
    setDeleting(true)
    const { error } = await supabase.from('expenses').delete().eq('priority_code', deleteConfirm)
    setDeleting(false)
    if (error) { showToast('error', `Delete failed: ${error.message}`); setDeleteConfirm(null); return }
    setRows(prev => prev.filter(r => r.priority_code !== deleteConfirm))
    setDeleteConfirm(null)
    showToast('success', 'Item deleted.')
  }

  const TH = ({ children, w }) => (
    <th className={`px-3 py-2.5 text-left text-[0.6rem] font-bold uppercase tracking-[0.14em] text-[#8A7BAB] ${w ?? ''}`}>
      {children}
    </th>
  )

  return (
    <div>
      {/* Toolbar */}
      <div className="mb-4 flex items-center gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#8A7BAB]" />
          <input
            value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search by code, name, category…"
            className="w-full rounded-xl border border-[rgba(74,20,140,0.18)] bg-white py-2 pl-9 pr-4 text-sm text-[#4B4594] outline-none focus:border-[#4B4594] focus:ring-2 focus:ring-[#4B4594]/15"
          />
        </div>
        <button
          type="button" onClick={() => { setAdding(true); setEditingId(null) }}
          className="flex items-center gap-1.5 rounded-xl bg-[#4A148C] px-4 py-2 text-[11px] font-semibold text-white shadow-sm transition hover:bg-[#6A1B9A]"
        >
          <Plus className="h-3.5 w-3.5" /> Add Item
        </button>
      </div>

      <Toast toast={toast} />

      {/* Delete confirmation */}
      {deleteConfirm && (
        <div className="mb-4 flex items-center gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3">
          <AlertTriangle className="h-4 w-4 shrink-0 text-red-600" />
          <p className="flex-1 text-sm text-red-700">
            Delete item <strong>{deleteConfirm}</strong>? This cannot be undone. Existing entries linked to this code will lose their catalog reference.
          </p>
          <button onClick={() => setDeleteConfirm(null)} className="rounded-lg px-3 py-1.5 text-xs font-semibold text-[#8A7BAB] hover:bg-red-100">Cancel</button>
          <button onClick={confirmDelete} disabled={deleting}
            className="flex items-center gap-1 rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-50">
            {deleting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />} Delete
          </button>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-[#4B4594]" /></div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-[rgba(74,20,140,0.12)] bg-white shadow-sm">
          <table className="w-full border-collapse text-sm">
            <thead className="bg-[#F7F2FF]">
              <tr>
                <TH w="w-28">Priority Code</TH>
                <TH>Name</TH>
                <TH w="w-32">Category</TH>
                <TH w="w-32">Media Budget Code</TH>
                <TH w="w-28">Reporting Code</TH>
                <TH w="w-24">Actions</TH>
              </tr>
            </thead>
            <tbody>
              {/* Add new row */}
              {adding && (
                <tr className="border-t border-[rgba(74,20,140,0.1)] bg-[#F4F0FF]">
                  <td className="px-3 py-2"><TInput value={newRow.priority_code} onChange={v => setNewRow(p => ({ ...p, priority_code: v }))} placeholder="Code *" /></td>
                  <td className="px-3 py-2"><TInput value={newRow.expense_description} onChange={v => setNewRow(p => ({ ...p, expense_description: v }))} placeholder="Name *" /></td>
                  <td className="px-3 py-2"><TSelect value={newRow.expense_type} onChange={v => setNewRow(p => ({ ...p, expense_type: v }))} options={EXPENSE_CATEGORY_OPTIONS} placeholder="Category…" /></td>
                  <td className="px-3 py-2"><TInput value={newRow.media_budget_code} onChange={v => setNewRow(p => ({ ...p, media_budget_code: v }))} placeholder="Code…" /></td>
                  <td className="px-3 py-2"><TInput value={newRow.reporting_code} onChange={v => setNewRow(p => ({ ...p, reporting_code: v }))} placeholder="Rpt code…" /></td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-1.5">
                      <button onClick={saveNew} disabled={saving}
                        className="flex items-center gap-1 rounded-lg bg-[#2FA36B] px-2.5 py-1.5 text-[10px] font-semibold text-white transition hover:bg-[#28915f] disabled:opacity-50">
                        {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />} Save
                      </button>
                      <button onClick={() => setAdding(false)} className="rounded-lg px-2 py-1.5 text-[10px] font-semibold text-[#8A7BAB] hover:bg-slate-100">✕</button>
                    </div>
                  </td>
                </tr>
              )}

              {filtered.length === 0 && !adding && (
                <tr><td colSpan={6} className="py-12 text-center text-sm text-[#8A7BAB]">No items found.</td></tr>
              )}

              {filtered.map(row => {
                const isEditing = editingId === row.priority_code
                return (
                  <tr key={row.priority_code} className={`border-t border-[rgba(74,20,140,0.06)] transition-colors ${isEditing ? 'bg-[#F4F0FF]' : 'hover:bg-[#FAFAFE]'}`}>
                    <td className="px-3 py-2.5 font-['JetBrains_Mono',ui-monospace,monospace] text-[12px] font-semibold text-[#4A148C]">
                      {row.priority_code}
                    </td>
                    <td className="px-3 py-2.5">
                      {isEditing
                        ? <TInput value={draft.expense_description} onChange={v => setDraft(p => ({ ...p, expense_description: v }))} />
                        : <span className="text-[#2D1B69]">{row.expense_description}</span>
                      }
                    </td>
                    <td className="px-3 py-2.5">
                      {isEditing
                        ? <TSelect value={draft.expense_type} onChange={v => setDraft(p => ({ ...p, expense_type: v }))} options={EXPENSE_CATEGORY_OPTIONS} />
                        : <span className={`inline-flex rounded-md px-2 py-0.5 text-[10px] font-semibold ${
                            row.expense_type === 'Media'
                              ? 'bg-[#EFF6FF] text-[#1D4ED8]'
                              : row.expense_type === 'Independent'
                              ? 'bg-[#FFFBEB] text-[#92400E]'
                              : 'bg-slate-100 text-[#6A5B88]'
                          }`}>{row.expense_type || '—'}</span>
                      }
                    </td>
                    <td className="px-3 py-2.5">
                      {isEditing
                        ? <TInput value={draft.media_budget_code} onChange={v => setDraft(p => ({ ...p, media_budget_code: v }))} />
                        : <span className="text-[#5B4B7A]">{row.media_budget_code || '—'}</span>
                      }
                    </td>
                    <td className="px-3 py-2.5">
                      {isEditing
                        ? <TInput value={draft.reporting_code} onChange={v => setDraft(p => ({ ...p, reporting_code: v }))} />
                        : <span className="text-[#8A7BAB]">{row.reporting_code || '—'}</span>
                      }
                    </td>
                    <td className="px-3 py-2.5">
                      {isEditing ? (
                        <div className="flex items-center gap-1.5">
                          <button onClick={saveEdit} disabled={saving}
                            className="flex items-center gap-1 rounded-lg bg-[#2FA36B] px-2.5 py-1.5 text-[10px] font-semibold text-white transition hover:bg-[#28915f] disabled:opacity-50">
                            {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />} Save
                          </button>
                          <button onClick={() => setEditingId(null)} className="rounded-lg px-2 py-1.5 text-[10px] font-semibold text-[#8A7BAB] hover:bg-slate-100">✕</button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1.5">
                          <button onClick={() => startEdit(row)} title="Edit"
                            className="rounded-lg p-1.5 text-[#4B4594] transition hover:bg-[#EDE8F8]">
                            <Edit2 className="h-3.5 w-3.5" />
                          </button>
                          <button onClick={() => setDeleteConfirm(row.priority_code)} title="Delete"
                            className="rounded-lg p-1.5 text-[#C62828] transition hover:bg-[#FFEBEE]">
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <div className="border-t border-[rgba(74,20,140,0.06)] px-4 py-2 text-[10px] text-[#A09ABB]">
            {filtered.length} item{filtered.length !== 1 ? 's' : ''}{search ? ` matching "${search}"` : ' total'}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Rentals Catalog ───────────────────────────────────────────────────────────
function RentalsCatalog() {
  const [rows, setRows]               = useState([])
  const [loading, setLoading]         = useState(true)
  const [search, setSearch]           = useState('')
  const [editingId, setEditingId]     = useState(null)
  const [draft, setDraft]             = useState({})
  const [saving, setSaving]           = useState(false)
  const [adding, setAdding]           = useState(false)
  const [newRow, setNewRow]           = useState(emptyRental())
  const [deleteConfirm, setDeleteConfirm] = useState(null)
  const [deleting, setDeleting]       = useState(false)
  const [toast, setToast]             = useState(null)

  function emptyRental() {
    return { priority_code: '', income_description: '', reporting_code: '', format_type: '' }
  }

  function showToast(type, message) {
    setToast({ type, message })
    setTimeout(() => setToast(null), 3500)
  }

  async function load() {
    setLoading(true)
    const { data, error } = await supabase
      .from('rentals')
      .select('priority_code, income_description, reporting_code, format_type')
      .order('priority_code')
    if (!error) setRows(data ?? [])
    setLoading(false)
  }

  useEffect(() => { void load() }, [])

  const filtered = rows.filter(r => {
    const q = search.toLowerCase()
    return !q
      || String(r.priority_code ?? '').toLowerCase().includes(q)
      || String(r.income_description ?? '').toLowerCase().includes(q)
      || String(r.reporting_code ?? '').toLowerCase().includes(q)
      || String(r.format_type ?? '').toLowerCase().includes(q)
  })

  function startEdit(row) {
    setEditingId(row.priority_code)
    setDraft({ ...row })
  }

  async function saveEdit() {
    setSaving(true)
    const { error } = await supabase
      .from('rentals')
      .update({
        income_description: draft.income_description,
        reporting_code:     draft.reporting_code  || null,
        format_type:        draft.format_type     || null,
      })
      .eq('priority_code', draft.priority_code)
    setSaving(false)
    if (error) { showToast('error', `Save failed: ${error.message}`); return }
    setRows(prev => prev.map(r => r.priority_code === draft.priority_code ? { ...draft } : r))
    setEditingId(null)
    showToast('success', 'Row updated successfully.')
  }

  async function saveNew() {
    if (!newRow.priority_code.trim() || !newRow.income_description.trim()) {
      showToast('error', 'Priority Code and Name are required.')
      return
    }
    setSaving(true)
    const { data, error } = await supabase
      .from('rentals')
      .insert([{
        priority_code:      newRow.priority_code.trim(),
        income_description: newRow.income_description.trim(),
        reporting_code:     newRow.reporting_code  || null,
        format_type:        newRow.format_type     || null,
      }])
      .select()
    setSaving(false)
    if (error) { showToast('error', `Add failed: ${error.message}`); return }
    setRows(prev => [...prev, ...(data ?? [])])
    setNewRow(emptyRental())
    setAdding(false)
    showToast('success', 'New rental item added.')
  }

  async function confirmDelete() {
    setDeleting(true)
    const { error } = await supabase.from('rentals').delete().eq('priority_code', deleteConfirm)
    setDeleting(false)
    if (error) { showToast('error', `Delete failed: ${error.message}`); setDeleteConfirm(null); return }
    setRows(prev => prev.filter(r => r.priority_code !== deleteConfirm))
    setDeleteConfirm(null)
    showToast('success', 'Item deleted.')
  }

  const TH = ({ children, w }) => (
    <th className={`px-3 py-2.5 text-left text-[0.6rem] font-bold uppercase tracking-[0.14em] text-[#8A7BAB] ${w ?? ''}`}>
      {children}
    </th>
  )

  return (
    <div>
      {/* Toolbar */}
      <div className="mb-4 flex items-center gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#8A7BAB]" />
          <input
            value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search by code, name, format…"
            className="w-full rounded-xl border border-[rgba(74,20,140,0.18)] bg-white py-2 pl-9 pr-4 text-sm text-[#4B4594] outline-none focus:border-[#4B4594] focus:ring-2 focus:ring-[#4B4594]/15"
          />
        </div>
        <button
          type="button" onClick={() => { setAdding(true); setEditingId(null) }}
          className="flex items-center gap-1.5 rounded-xl bg-[#4A148C] px-4 py-2 text-[11px] font-semibold text-white shadow-sm transition hover:bg-[#6A1B9A]"
        >
          <Plus className="h-3.5 w-3.5" /> Add Item
        </button>
      </div>

      <Toast toast={toast} />

      {/* Delete confirmation */}
      {deleteConfirm && (
        <div className="mb-4 flex items-center gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3">
          <AlertTriangle className="h-4 w-4 shrink-0 text-red-600" />
          <p className="flex-1 text-sm text-red-700">
            Delete item <strong>{deleteConfirm}</strong>? Existing rental transactions linked to this code will lose their catalog reference.
          </p>
          <button onClick={() => setDeleteConfirm(null)} className="rounded-lg px-3 py-1.5 text-xs font-semibold text-[#8A7BAB] hover:bg-red-100">Cancel</button>
          <button onClick={confirmDelete} disabled={deleting}
            className="flex items-center gap-1 rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-50">
            {deleting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />} Delete
          </button>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-[#4B4594]" /></div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-[rgba(74,20,140,0.12)] bg-white shadow-sm">
          <table className="w-full border-collapse text-sm">
            <thead className="bg-[#F7F2FF]">
              <tr>
                <TH w="w-28">Priority Code</TH>
                <TH>Item Name</TH>
                <TH w="w-36">Format / Category</TH>
                <TH w="w-28">Reporting Code</TH>
                <TH w="w-24">Actions</TH>
              </tr>
            </thead>
            <tbody>
              {/* Add new row */}
              {adding && (
                <tr className="border-t border-[rgba(74,20,140,0.1)] bg-[#F4F0FF]">
                  <td className="px-3 py-2"><TInput value={newRow.priority_code} onChange={v => setNewRow(p => ({ ...p, priority_code: v }))} placeholder="Code *" /></td>
                  <td className="px-3 py-2"><TInput value={newRow.income_description} onChange={v => setNewRow(p => ({ ...p, income_description: v }))} placeholder="Item name *" /></td>
                  <td className="px-3 py-2"><TSelect value={newRow.format_type} onChange={v => setNewRow(p => ({ ...p, format_type: v }))} options={RENTAL_CATEGORY_OPTIONS} placeholder="Format…" /></td>
                  <td className="px-3 py-2"><TInput value={newRow.reporting_code} onChange={v => setNewRow(p => ({ ...p, reporting_code: v }))} placeholder="Rpt code…" /></td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-1.5">
                      <button onClick={saveNew} disabled={saving}
                        className="flex items-center gap-1 rounded-lg bg-[#2FA36B] px-2.5 py-1.5 text-[10px] font-semibold text-white transition hover:bg-[#28915f] disabled:opacity-50">
                        {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />} Save
                      </button>
                      <button onClick={() => setAdding(false)} className="rounded-lg px-2 py-1.5 text-[10px] font-semibold text-[#8A7BAB] hover:bg-slate-100">✕</button>
                    </div>
                  </td>
                </tr>
              )}

              {filtered.length === 0 && !adding && (
                <tr><td colSpan={5} className="py-12 text-center text-sm text-[#8A7BAB]">No items found.</td></tr>
              )}

              {filtered.map(row => {
                const isEditing = editingId === row.priority_code
                return (
                  <tr key={row.priority_code} className={`border-t border-[rgba(74,20,140,0.06)] transition-colors ${isEditing ? 'bg-[#F4F0FF]' : 'hover:bg-[#FAFAFE]'}`}>
                    <td className="px-3 py-2.5 font-['JetBrains_Mono',ui-monospace,monospace] text-[12px] font-semibold text-[#4A148C]">
                      {row.priority_code}
                    </td>
                    <td className="px-3 py-2.5">
                      {isEditing
                        ? <TInput value={draft.income_description} onChange={v => setDraft(p => ({ ...p, income_description: v }))} />
                        : <span className="text-[#2D1B69]">{row.income_description}</span>
                      }
                    </td>
                    <td className="px-3 py-2.5">
                      {isEditing
                        ? <TSelect value={draft.format_type} onChange={v => setDraft(p => ({ ...p, format_type: v }))} options={RENTAL_CATEGORY_OPTIONS} />
                        : <span className="inline-flex rounded-md bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-[#6A5B88]">
                            {row.format_type || '—'}
                          </span>
                      }
                    </td>
                    <td className="px-3 py-2.5">
                      {isEditing
                        ? <TInput value={draft.reporting_code} onChange={v => setDraft(p => ({ ...p, reporting_code: v }))} />
                        : <span className="text-[#8A7BAB]">{row.reporting_code || '—'}</span>
                      }
                    </td>
                    <td className="px-3 py-2.5">
                      {isEditing ? (
                        <div className="flex items-center gap-1.5">
                          <button onClick={saveEdit} disabled={saving}
                            className="flex items-center gap-1 rounded-lg bg-[#2FA36B] px-2.5 py-1.5 text-[10px] font-semibold text-white transition hover:bg-[#28915f] disabled:opacity-50">
                            {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />} Save
                          </button>
                          <button onClick={() => setEditingId(null)} className="rounded-lg px-2 py-1.5 text-[10px] font-semibold text-[#8A7BAB] hover:bg-slate-100">✕</button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1.5">
                          <button onClick={() => startEdit(row)} title="Edit"
                            className="rounded-lg p-1.5 text-[#4B4594] transition hover:bg-[#EDE8F8]">
                            <Edit2 className="h-3.5 w-3.5" />
                          </button>
                          <button onClick={() => setDeleteConfirm(row.priority_code)} title="Delete"
                            className="rounded-lg p-1.5 text-[#C62828] transition hover:bg-[#FFEBEE]">
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <div className="border-t border-[rgba(74,20,140,0.06)] px-4 py-2 text-[10px] text-[#A09ABB]">
            {filtered.length} item{filtered.length !== 1 ? 's' : ''}{search ? ` matching "${search}"` : ' total'}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Main Modal (tabbed) ───────────────────────────────────────────────────────
export function CatalogsManagementModal({ onClose, defaultTab = 'expenses' }) {
  const [activeTab, setActiveTab] = useState(defaultTab)

  const TABS = [
    { id: 'expenses', label: 'Expenses Catalog', desc: 'Manage expense categories and media budget codes' },
    { id: 'rentals',  label: 'Rentals Catalog',  desc: 'Manage rental / income categories and format types' },
  ]
  const current = TABS.find(t => t.id === activeTab)

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 pt-8 backdrop-blur-sm">
      <div className="w-full max-w-5xl rounded-2xl bg-white shadow-[0_32px_80px_rgba(74,20,140,0.22)]">

        {/* Header */}
        <div className="flex items-start justify-between border-b border-[rgba(74,20,140,0.12)] px-6 py-5">
          <div>
            <p className="text-[0.6rem] font-bold uppercase tracking-[0.2em] text-[#8A7BAB]">Admin · Catalog Management</p>
            <h2 className="mt-0.5 font-['Montserrat',sans-serif] text-xl font-extrabold text-[#4A148C]">{current?.label}</h2>
            <p className="text-xs text-[#8A7BAB]">{current?.desc}</p>
          </div>
          <button type="button" onClick={onClose}
            className="rounded-xl border border-[rgba(74,20,140,0.15)] p-2 text-[#8A7BAB] transition hover:bg-[#F7F2FF] hover:text-[#4A148C]">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 border-b border-[rgba(74,20,140,0.1)] px-6">
          {TABS.map(({ id, label }) => (
            <button
              key={id} type="button" onClick={() => setActiveTab(id)}
              className={`px-4 py-3 text-[11px] font-semibold tracking-wide transition border-b-2 -mb-px ${
                activeTab === id
                  ? 'border-[#4A148C] text-[#4A148C]'
                  : 'border-transparent text-[#8A7BAB] hover:text-[#4A148C]'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="p-6">
          {activeTab === 'expenses' ? <ExpensesCatalog /> : <RentalsCatalog />}
        </div>
      </div>
    </div>
  )
}
