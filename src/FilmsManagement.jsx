import { useEffect, useRef, useState } from 'react'
import {
  AlertTriangle, CheckCircle, Edit2, Loader2,
  Save, Search, X,
} from 'lucide-react'
import { supabase } from './lib/supabaseClient'

// ── tiny helpers ──────────────────────────────────────────────────────────────

function Input({ value, onChange, placeholder, className = '', dir }) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      dir={dir}
      className={`w-full rounded-lg border border-[rgba(74,20,140,0.2)] bg-white px-2.5 py-1.5 text-sm text-[#4B4594] outline-none transition focus:border-[#4B4594] focus:ring-2 focus:ring-[#4B4594]/20 ${className}`}
    />
  )
}

function Cell({ children, className = '' }) {
  return (
    <td className={`px-3 py-3 text-sm text-[#5B4B7A] ${className}`}>{children}</td>
  )
}

// ── main component ────────────────────────────────────────────────────────────

export function FilmsManagementModal({ onClose }) {
  const [searchTerm, setSearchTerm]   = useState('')
  const [films, setFilms]             = useState([])
  const [loading, setLoading]         = useState(false)
  const [editingId, setEditingId]     = useState(null)   // film_number being edited
  const [draft, setDraft]             = useState({})
  const [saving, setSaving]           = useState(false)
  const [saveError, setSaveError]     = useState(null)
  const [toast, setToast]             = useState(null)   // { type, message }
  const [confirmFnChange, setConfirmFnChange] = useState(null) // { oldFn, newFn, payload }

  const debounceRef = useRef(null)

  // ── load recent on mount ───────────────────────────────────────────────────
  useEffect(() => { void loadRecent() }, [])

  async function loadRecent() {
    setLoading(true)
    const { data } = await supabase
      .from('films')
      .select('film_number, title_en, title_he, studio, profit_center, release_date')
      .order('film_number', { ascending: false })
      .limit(25)
    setFilms(data ?? [])
    setLoading(false)
  }

  // ── debounced search ───────────────────────────────────────────────────────
  useEffect(() => {
    clearTimeout(debounceRef.current)
    const needle = searchTerm.trim()
    if (!needle) { void loadRecent(); return }
    debounceRef.current = setTimeout(async () => {
      setLoading(true)
      const { data } = await supabase
        .from('films')
        .select('film_number, title_en, title_he, studio, profit_center, release_date')
        .or(
          `title_en.ilike.%${needle}%,title_he.ilike.%${needle}%,studio.ilike.%${needle}%,film_number.ilike.%${needle}%,profit_center.ilike.%${needle}%`,
        )
        .limit(50)
      setFilms(data ?? [])
      setLoading(false)
    }, 350)
    return () => clearTimeout(debounceRef.current)
  }, [searchTerm])

  // ── edit helpers ───────────────────────────────────────────────────────────
  function startEdit(film) {
    setEditingId(film.film_number)
    setDraft({
      film_number:  film.film_number ?? '',
      title_en:     film.title_en    ?? '',
      title_he:     film.title_he    ?? '',
      studio:       film.studio      ?? '',
      profit_center: film.profit_center ?? '',
      release_date: film.release_date ? film.release_date.slice(0, 10) : '',
    })
    setSaveError(null)
  }

  function cancelEdit() {
    setEditingId(null)
    setDraft({})
    setSaveError(null)
    setConfirmFnChange(null)
  }

  function patchDraft(key, val) {
    setDraft((d) => ({ ...d, [key]: val }))
  }

  // ── save ───────────────────────────────────────────────────────────────────
  async function handleSave(originalFilm) {
    setSaveError(null)
    const payload = {
      title_en:      draft.title_en     || null,
      title_he:      draft.title_he     || null,
      studio:        draft.studio       || null,
      profit_center: draft.profit_center || null,
      release_date:  draft.release_date  || null,
    }
    const newFn = draft.film_number.trim()
    const oldFn = originalFilm.film_number

    if (!newFn) { setSaveError('Film number cannot be empty.'); return }

    if (newFn !== oldFn) {
      // Warn the user before touching FKs
      setConfirmFnChange({ oldFn, newFn, payload })
    } else {
      await executeUpdate(oldFn, oldFn, payload)
    }
  }

  async function executeUpdate(oldFn, newFn, payload) {
    setSaving(true)
    setSaveError(null)
    try {
      if (oldFn !== newFn) {
        // Cascade update to child tables first
        await Promise.all([
          supabase.from('actual_expenses')    .update({ film_number: newFn }).eq('film_number', oldFn),
          supabase.from('rental_transactions').update({ film_number: newFn }).eq('film_number', oldFn),
          supabase.from('budgets')            .update({ film_number: newFn }).eq('film_number', oldFn),
        ])
        const { error } = await supabase.from('films').update({ ...payload, film_number: newFn }).eq('film_number', oldFn)
        if (error) throw error
      } else {
        const { error } = await supabase.from('films').update(payload).eq('film_number', oldFn)
        if (error) throw error
      }

      // Update local list
      setFilms((prev) =>
        prev.map((f) =>
          f.film_number === oldFn ? { ...f, ...payload, film_number: newFn } : f,
        ),
      )
      setEditingId(null)
      setDraft({})
      setConfirmFnChange(null)
      showToast('success', 'Changes saved successfully.')
    } catch (err) {
      setSaveError(err.message ?? String(err))
    } finally {
      setSaving(false)
    }
  }

  function showToast(type, message) {
    setToast({ type, message })
    setTimeout(() => setToast(null), 3500)
  }

  // ── render ─────────────────────────────────────────────────────────────────
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-[#1a1030]/50 p-4 pt-[max(3rem,env(safe-area-inset-top))] backdrop-blur-[2px]"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        className="relative w-full max-w-5xl rounded-2xl border border-[rgba(74,20,140,0.18)] bg-white shadow-[0_32px_72px_rgba(74,20,140,0.22)]"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[rgba(74,20,140,0.12)] px-6 py-4">
          <div>
            <h2 className="font-['Montserrat',sans-serif] text-base font-bold text-[#4B4594]">Films Management</h2>
            <p className="text-[11px] text-[#8A7BAB]">Search, view and edit film metadata</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-[#8A7BAB] transition hover:bg-[#F7F2FF] hover:text-[#4A148C]"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Search */}
        <div className="border-b border-[rgba(74,20,140,0.08)] px-6 py-4">
          <div className="flex items-center gap-2 rounded-xl border border-[rgba(74,20,140,0.2)] bg-[#FAFAFE] px-3.5 py-2.5 shadow-sm">
            {loading
              ? <Loader2 className="h-4 w-4 shrink-0 animate-spin text-[#4A148C]" />
              : <Search className="h-4 w-4 shrink-0 text-[#4A148C]" />}
            <input
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search by title (English or Hebrew), studio, film number, or profit center…"
              className="w-full bg-transparent text-sm text-[#5B4B7A] outline-none placeholder:text-[#9A8AB8]"
            />
            {searchTerm && (
              <button type="button" onClick={() => setSearchTerm('')} className="shrink-0 text-[#9A8AB8] hover:text-[#4A148C]">
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          <p className="mt-1.5 text-[10px] text-[#9A8AB8]">
            {searchTerm.trim() ? `${films.length} result${films.length !== 1 ? 's' : ''} found` : `Showing ${films.length} most recent films`}
          </p>
        </div>

        {/* Toast */}
        {toast && (
          <div className={`mx-6 mt-4 flex items-center gap-2.5 rounded-xl px-4 py-3 text-sm font-medium ${toast.type === 'success' ? 'border border-green-200 bg-green-50 text-green-800' : 'border border-red-200 bg-red-50 text-red-800'}`}>
            {toast.type === 'success'
              ? <CheckCircle className="h-4 w-4 shrink-0 text-green-500" />
              : <AlertTriangle className="h-4 w-4 shrink-0 text-red-500" />}
            {toast.message}
          </div>
        )}

        {/* Table */}
        <div className="overflow-x-auto px-6 pb-6 pt-4">
          {films.length === 0 && !loading && (
            <p className="py-12 text-center text-sm text-[#8A7BAB]">
              {searchTerm.trim() ? 'No films match your search.' : 'Start typing to search for films.'}
            </p>
          )}

          {films.length > 0 && (
            <table className="w-full min-w-[700px] border-collapse text-left">
              <thead>
                <tr className="border-b border-[rgba(74,20,140,0.1)]">
                  {['Film Number', 'English Title', 'Hebrew Title', 'Studio', 'Profit Center', 'Release Date', ''].map((h) => (
                    <th key={h} className="pb-2 pr-3 text-[0.6rem] font-semibold uppercase tracking-[0.16em] text-[#8A7BAB]">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {films.map((film) => {
                  const isEditing = editingId === film.film_number
                  return (
                    <tr
                      key={film.film_number}
                      className={`border-b border-[rgba(74,20,140,0.06)] transition ${isEditing ? 'bg-[#F7F2FF]' : 'hover:bg-[#FAFAFE]'}`}
                    >
                      {isEditing ? (
                        <>
                          {/* Film Number */}
                          <Cell>
                            <Input
                              value={draft.film_number}
                              onChange={(v) => patchDraft('film_number', v)}
                              placeholder="Film #"
                              className="font-['JetBrains_Mono',ui-monospace,monospace] text-xs"
                            />
                            {draft.film_number !== film.film_number && (
                              <p className="mt-1 text-[10px] text-amber-600 flex items-center gap-1">
                                <AlertTriangle className="h-3 w-3" /> Changing this cascades to expenses, income & budgets
                              </p>
                            )}
                          </Cell>
                          {/* English Title */}
                          <Cell><Input value={draft.title_en} onChange={(v) => patchDraft('title_en', v)} placeholder="English title" /></Cell>
                          {/* Hebrew Title */}
                          <Cell><Input value={draft.title_he} onChange={(v) => patchDraft('title_he', v)} placeholder="שם בעברית" dir="rtl" /></Cell>
                          {/* Studio */}
                          <Cell><Input value={draft.studio} onChange={(v) => patchDraft('studio', v)} placeholder="Studio" /></Cell>
                          {/* Profit Center */}
                          <Cell>
                            <Input
                              value={draft.profit_center}
                              onChange={(v) => patchDraft('profit_center', v)}
                              placeholder="e.g. 30015"
                              className="font-['JetBrains_Mono',ui-monospace,monospace] text-xs"
                            />
                          </Cell>
                          {/* Release Date */}
                          <Cell>
                            <input
                              type="date"
                              value={draft.release_date}
                              onChange={(e) => patchDraft('release_date', e.target.value)}
                              className="w-full rounded-lg border border-[rgba(74,20,140,0.2)] bg-white px-2.5 py-1.5 text-sm text-[#4B4594] outline-none transition focus:border-[#4B4594] focus:ring-2 focus:ring-[#4B4594]/20"
                            />
                          </Cell>
                          {/* Actions */}
                          <Cell className="whitespace-nowrap">
                            {saveError && (
                              <p className="mb-1.5 rounded-lg bg-red-50 px-2 py-1 text-[11px] text-red-700">{saveError}</p>
                            )}
                            <div className="flex items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => handleSave(film)}
                                disabled={saving}
                                className="inline-flex items-center gap-1 rounded-lg bg-[#2FA36B] px-2.5 py-1.5 text-[11px] font-semibold text-white transition hover:bg-[#28915f] disabled:opacity-50"
                              >
                                {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                                Save
                              </button>
                              <button
                                type="button"
                                onClick={cancelEdit}
                                disabled={saving}
                                className="inline-flex items-center gap-1 rounded-lg border border-[rgba(74,20,140,0.2)] bg-white px-2.5 py-1.5 text-[11px] font-semibold text-[#4A148C] transition hover:bg-[#F7F2FF] disabled:opacity-50"
                              >
                                <X className="h-3 w-3" /> Cancel
                              </button>
                            </div>
                          </Cell>
                        </>
                      ) : (
                        <>
                          <Cell>
                            <span className="font-['JetBrains_Mono',ui-monospace,monospace] text-xs font-semibold text-[#7B52AB]">
                              {film.film_number}
                            </span>
                          </Cell>
                          <Cell className="font-medium text-[#4B4594]">{film.title_en || <span className="text-[#C0B8D8]">—</span>}</Cell>
                          <Cell dir="rtl" lang="he" className="text-right">{film.title_he || <span className="text-[#C0B8D8]">—</span>}</Cell>
                          <Cell>{film.studio || <span className="text-[#C0B8D8]">—</span>}</Cell>
                          <Cell>
                            <span className="font-['JetBrains_Mono',ui-monospace,monospace] text-xs text-[#7B52AB]">
                              {film.profit_center || <span className="text-[#C0B8D8]">—</span>}
                            </span>
                          </Cell>
                          <Cell>{film.release_date ? film.release_date.slice(0, 10) : <span className="text-[#C0B8D8]">—</span>}</Cell>
                          <Cell>
                            <button
                              type="button"
                              onClick={() => startEdit(film)}
                              className="inline-flex items-center gap-1 rounded-lg border border-[rgba(74,20,140,0.2)] px-2.5 py-1.5 text-[11px] font-semibold text-[#4A148C] transition hover:bg-[#F7F2FF]"
                            >
                              <Edit2 className="h-3 w-3" /> Edit
                            </button>
                          </Cell>
                        </>
                      )}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* ── Film number change confirmation ───────────────────────────────── */}
      {confirmFnChange && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center p-4"
          onMouseDown={(e) => { if (e.target === e.currentTarget) setConfirmFnChange(null) }}
        >
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" aria-hidden />
          <div
            className="relative z-10 w-full max-w-sm rounded-2xl border border-amber-200 bg-white p-6 shadow-[0_32px_64px_rgba(0,0,0,0.22)]"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-50">
                <AlertTriangle className="h-5 w-5 text-amber-500" />
              </div>
              <div>
                <h3 className="font-['Montserrat',sans-serif] font-bold text-[#4B4594]">Change Film Number?</h3>
                <p className="text-xs text-[#8A7BAB]">This will cascade to related tables</p>
              </div>
            </div>

            <p className="mb-1 text-sm text-[#5B4B7A]">
              Changing from{' '}
              <code className="rounded bg-[#F4F1FF] px-1.5 py-0.5 font-['JetBrains_Mono',ui-monospace,monospace] text-xs text-[#7B52AB]">
                {confirmFnChange.oldFn}
              </code>{' '}
              to{' '}
              <code className="rounded bg-[#F4F1FF] px-1.5 py-0.5 font-['JetBrains_Mono',ui-monospace,monospace] text-xs text-[#7B52AB]">
                {confirmFnChange.newFn}
              </code>
            </p>
            <p className="mb-5 text-xs leading-relaxed text-[#8A7BAB]">
              All linked rows in <strong>Budgets</strong>, <strong>Actual Expenses</strong>, and <strong>Rental Transactions</strong> will be updated to the new film number.
              This cannot be undone automatically.
            </p>

            {saveError && (
              <p className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{saveError}</p>
            )}

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmFnChange(null)}
                disabled={saving}
                className="rounded-xl border border-[rgba(74,20,140,0.2)] bg-white px-4 py-2 text-sm font-semibold text-[#4A148C] transition hover:bg-[#F7F2FF] disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => executeUpdate(confirmFnChange.oldFn, confirmFnChange.newFn, confirmFnChange.payload)}
                disabled={saving}
                className="inline-flex items-center gap-2 rounded-xl bg-amber-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-amber-600 disabled:opacity-50"
              >
                {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                Yes, update all tables
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
