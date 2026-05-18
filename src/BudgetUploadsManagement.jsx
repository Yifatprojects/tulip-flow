import { useEffect, useState } from 'react'
import {
  AlertTriangle, BookOpen, CheckCircle, Loader2, Trash2, X,
} from 'lucide-react'
import { supabase } from './lib/supabaseClient'

// ── helpers ───────────────────────────────────────────────────────────────────

function fmt(n) {
  return '₪' + Math.abs(n).toLocaleString('en-IL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtTs(isoStr) {
  if (!isoStr) return null
  return new Date(isoStr).toLocaleString('en-GB', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

// ── Toast ─────────────────────────────────────────────────────────────────────

function Toast({ toast }) {
  if (!toast) return null
  const isOk   = toast.type === 'success'
  const isBusy = toast.type === 'busy'
  return (
    <div className={`mb-4 flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold ${
      isOk   ? 'border border-[rgba(47,163,107,0.3)] bg-[#F0FBF5] text-[#1a7a4e]'
      : isBusy ? 'border border-[rgba(74,20,140,0.2)] bg-[#F7F4FB] text-[#4B4594]'
               : 'border border-red-200 bg-red-50 text-red-700'
    }`}>
      {isBusy
        ? <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
        : isOk
        ? <CheckCircle className="h-4 w-4 shrink-0" />
        : <AlertTriangle className="h-4 w-4 shrink-0" />}
      {toast.message}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function BudgetUploadsManagementModal({ onClose }) {
  const [loading,  setLoading]  = useState(true)
  const [batches,  setBatches]  = useState([])
  const [confirm,  setConfirm]  = useState(null)
  const [deleting, setDeleting] = useState(false)
  const [toast,    setToast]    = useState(null)

  function showToast(type, message) {
    setToast({ type, message })
    if (type !== 'busy') setTimeout(() => setToast(null), 4000)
  }

  // ── Data loading ────────────────────────────────────────────────────────────

  async function load() {
    setLoading(true)
    try {
      // 1. film map: film_number → { title_en, title_he }
      const filmMap = new Map()
      let page = 0
      while (true) {
        const { data } = await supabase
          .from('films')
          .select('film_number, title_en, title_he')
          .range(page * 1000, page * 1000 + 999)
        if (!data || data.length === 0) break
        for (const f of data) filmMap.set(String(f.film_number).trim(), f)
        if (data.length < 1000) break
        page++
      }

      // 2. Fetch all budget rows
      const rows = []
      let p = 0
      while (true) {
        const { data } = await supabase
          .from('budgets')
          .select('film_number, planned_amount, created_at')
          .range(p * 1000, p * 1000 + 999)
        if (!data || data.length === 0) break
        rows.push(...data)
        if (data.length < 1000) break
        p++
      }

      // 3. Group by film_number
      const map = new Map()
      for (const r of rows) {
        const fn = String(r.film_number ?? '').trim()
        if (!map.has(fn)) {
          const film  = filmMap.get(fn)
          const title = film ? (film.title_en || film.title_he || fn) : fn
          map.set(fn, { film_number: fn, title, rowCount: 0, totalPlanned: 0, latestTs: null })
        }
        const b   = map.get(fn)
        b.rowCount++
        b.totalPlanned += Number(r.planned_amount) || 0
        const ts = r.created_at ?? null
        if (ts && (!b.latestTs || ts > b.latestTs)) b.latestTs = ts
      }

      // 4. Sort: most recently uploaded first
      const sorted = [...map.values()].sort((a, b) => {
        if (!a.latestTs && !b.latestTs) return a.title.localeCompare(b.title)
        if (!a.latestTs) return 1
        if (!b.latestTs) return -1
        return b.latestTs.localeCompare(a.latestTs)
      })

      setBatches(sorted)
    } catch (err) {
      console.error('[BudgetUploadsManager] load error', err)
    }
    setLoading(false)
  }

  useEffect(() => { void load() }, [])

  // ── Deletion ────────────────────────────────────────────────────────────────

  async function deleteBatch(batch) {
    setDeleting(true)
    showToast('busy', 'Deleting…')
    setConfirm(null)
    try {
      const { error } = await supabase
        .from('budgets')
        .delete()
        .eq('film_number', batch.film_number)
      if (error) throw error
      showToast('success', `Budget for "${batch.title}" deleted successfully.`)
      await load()
    } catch (err) {
      console.error('[BudgetUploadsManager] delete error', err)
      showToast('error', `Deletion failed: ${err.message}`)
    }
    setDeleting(false)
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  const totalFilms = batches.length

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 pt-12 backdrop-blur-sm"
         style={{ background: 'rgba(45,27,105,0.35)' }}>
      <div className="relative w-full max-w-3xl rounded-2xl border border-[rgba(74,20,140,0.18)] bg-white shadow-[0_32px_72px_rgba(74,20,140,0.24)]"
           style={{ maxHeight: '88vh', display: 'flex', flexDirection: 'column' }}>

        {/* ── Header ── */}
        <div className="flex shrink-0 items-center justify-between gap-4 border-b border-[rgba(74,20,140,0.1)] px-6 py-4">
          <div className="flex items-center gap-3">
            <BookOpen className="h-5 w-5 text-[#4B4594]" aria-hidden />
            <div>
              <h2 className="font-['Montserrat',sans-serif] text-base font-extrabold text-[#2D1B69]">Budget Upload History</h2>
              <p className="text-[11px] text-[#9A8AB8]">
                {loading ? 'Loading…' : `${totalFilms} film${totalFilms !== 1 ? 's' : ''} with uploaded budgets`}
              </p>
            </div>
          </div>
          <button type="button" onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-full text-[#9A8AB8] transition hover:bg-[#F0EBFF] hover:text-[#4A148C]">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* ── Body ── */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          <Toast toast={toast} />

          {loading && (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-7 w-7 animate-spin text-[#4B4594]" />
            </div>
          )}

          {!loading && batches.length === 0 && (
            <p className="py-12 text-center text-sm text-[#C0B8D8]">No budget uploads found.</p>
          )}

          {!loading && batches.length > 0 && (
            <div className="space-y-2">
              {batches.map((batch) => (
                <div key={batch.film_number}
                  className="flex items-center gap-3 rounded-xl border border-[rgba(74,20,140,0.1)] bg-[#FAFAFE] px-4 py-3 transition hover:border-[rgba(74,20,140,0.2)] hover:bg-white hover:shadow-sm">

                  {/* Film info */}
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-['Montserrat',sans-serif] text-sm font-extrabold text-[#2D1B69]">
                        {batch.title}
                      </span>
                      {batch.latestTs && (
                        <span className="text-[10px] text-[#B0A4CC]">{fmtTs(batch.latestTs)}</span>
                      )}
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-3">
                      <span className="text-[11px] font-semibold text-[#4B4594]">
                        {batch.rowCount} line{batch.rowCount !== 1 ? 's' : ''}
                      </span>
                      <span className="text-[11px] font-semibold text-[#2FA36B]">
                        Planned: {fmt(batch.totalPlanned)}
                      </span>
                    </div>
                  </div>

                  {/* Delete button */}
                  <button
                    type="button"
                    onClick={() => setConfirm(batch)}
                    disabled={deleting}
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[rgba(192,0,76,0.2)] bg-white text-[#C0004C] transition hover:bg-[#FFF1F3] disabled:opacity-40"
                    title="Delete this budget"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Confirmation modal ── */}
      {confirm && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4"
             style={{ background: 'rgba(45,27,105,0.5)' }}>
          <div className="w-full max-w-sm rounded-2xl border border-[rgba(192,0,76,0.2)] bg-white p-6 shadow-[0_24px_60px_rgba(74,20,140,0.28)]">
            <div className="mb-3 flex items-center gap-2">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[#FFF1F3]">
                <Trash2 className="h-4 w-4 text-[#C0004C]" />
              </div>
              <h3 className="font-['Montserrat',sans-serif] text-base font-extrabold text-[#2D1B69]">Confirm Deletion</h3>
            </div>

            <p className="mb-1 text-sm text-[#5B4B7A]">
              Are you sure you want to delete the budget for{' '}
              <strong>{confirm.title}</strong>?
            </p>
            <p className="mb-4 text-sm text-[#5B4B7A]">
              This will permanently remove{' '}
              <strong>{confirm.rowCount} line{confirm.rowCount !== 1 ? 's' : ''}</strong>
              {confirm.totalPlanned > 0 && (
                <> totalling <strong>{fmt(confirm.totalPlanned)}</strong></>
              )}{' '}
              from the system.{' '}
              <span className="font-semibold text-[#C0004C]">This action cannot be undone.</span>
            </p>

            <div className="flex gap-2">
              <button type="button"
                onClick={() => deleteBatch(confirm)}
                className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-[#C0004C] py-2.5 text-sm font-semibold text-white transition hover:bg-[#a3003f]">
                <Trash2 className="h-4 w-4" /> Delete permanently
              </button>
              <button type="button"
                onClick={() => setConfirm(null)}
                className="flex-1 rounded-xl border border-[rgba(74,20,140,0.2)] py-2.5 text-sm font-semibold text-[#4A148C] transition hover:bg-[#F7F2FF]">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
