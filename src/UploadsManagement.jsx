import { useEffect, useState } from 'react'
import {
  AlertTriangle, CheckCircle, History, Loader2,
  Trash2, X, TrendingDown, TrendingUp,
} from 'lucide-react'
import { supabase } from './lib/supabaseClient'

// ── helpers ───────────────────────────────────────────────────────────────────

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

function toMonthLabel(mp) {
  if (!mp) return mp
  const [yr, mo] = mp.split('-')
  return `${MONTHS[Number(mo) - 1] ?? mo} ${yr}`
}

function fmt(n) {
  return '₪' + Math.abs(n).toLocaleString('en-IL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function normaliseStudio(s) {
  if (!s) return 'Unknown'
  return s === 'Other' ? 'Independent' : s
}

// ── Toast ─────────────────────────────────────────────────────────────────────

function Toast({ toast }) {
  if (!toast) return null
  const isOk = toast.type === 'success'
  const isBusy = toast.type === 'busy'
  return (
    <div className={`mb-4 flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold ${
      isOk  ? 'border border-[rgba(47,163,107,0.3)] bg-[#F0FBF5] text-[#1a7a4e]'
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

export default function UploadsManagementModal({ onClose }) {
  const [loading, setLoading]       = useState(true)
  const [batches, setBatches]       = useState([])
  const [confirm, setConfirm]       = useState(null)  // batch to delete
  const [deleting, setDeleting]     = useState(false)
  const [toast, setToast]           = useState(null)

  function showToast(type, message) {
    setToast({ type, message })
    if (type !== 'busy') setTimeout(() => setToast(null), 4000)
  }

  // ── Data loading ────────────────────────────────────────────────────────────

  async function load() {
    setLoading(true)
    try {
      // 1. Build film → studio map (paginated)
      const filmMap = new Map() // norm(film_number or profit_center) → studio label
      let page = 0
      while (true) {
        const { data } = await supabase
          .from('films')
          .select('film_number, profit_center, profit_center_2, studio')
          .range(page * 1000, page * 1000 + 999)
        if (!data || data.length === 0) break
        for (const f of data) {
          const studio = normaliseStudio(f.studio)
          if (f.film_number)     filmMap.set(String(f.film_number).trim(),     studio)
          if (f.profit_center)   filmMap.set(String(f.profit_center).trim(),   studio)
          if (f.profit_center_2) filmMap.set(String(f.profit_center_2).trim(), studio)
        }
        if (data.length < 1000) break
        page++
      }

      // 2. Fetch transactions (paginated, only columns we need)
      const fetchAll = async (table, cols) => {
        const rows = []
        let p = 0
        while (true) {
          const { data } = await supabase.from(table).select(cols).range(p * 1000, p * 1000 + 999)
          if (!data || data.length === 0) break
          rows.push(...data)
          if (data.length < 1000) break
          p++
        }
        return rows
      }

      const [expRows, incRows] = await Promise.all([
        fetchAll('actual_expenses',   'film_number, month_period, actual_amount, created_at'),
        fetchAll('rental_transactions','film_number, month_period, actual_amount, created_at'),
      ])

      // 3. Aggregate into batches: key = `${month_period}||${studio}`
      const map = new Map()
      const addRow = (row, type) => {
        const studio = filmMap.get(String(row.film_number ?? '').trim()) ?? 'Unknown'
        const key    = `${row.month_period}||${studio}`
        if (!map.has(key)) {
          map.set(key, {
            month_period:  row.month_period,
            monthLabel:    toMonthLabel(row.month_period),
            studio,
            expenseCount:  0, expenseTotal:  0,
            incomeCount:   0, incomeTotal:   0,
            latestTs:      null,
          })
        }
        const b = map.get(key)
        const amt = Number(row.actual_amount) || 0
        const ts  = row.created_at ?? null
        if (ts && (!b.latestTs || ts > b.latestTs)) b.latestTs = ts
        if (type === 'exp') { b.expenseCount++; b.expenseTotal += amt }
        else                { b.incomeCount++;  b.incomeTotal  += amt }
      }

      expRows.forEach(r => addRow(r, 'exp'))
      incRows.forEach(r => addRow(r, 'inc'))

      // 4. Sort: most recent month_period first, then studio
      const sorted = [...map.values()].sort((a, b) => {
        if (b.month_period !== a.month_period) return b.month_period > a.month_period ? 1 : -1
        return a.studio.localeCompare(b.studio)
      })

      setBatches(sorted)
    } catch (err) {
      console.error('[UploadsManager] load error', err)
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
      // Collect all film_numbers that belong to this studio
      const studioFilms = []
      for (const [key, studio] of [...new Map(
        batches.flatMap(() => [])   // dummy — we rebuild from filmMap inside load
      )]) { /* unused */ }

      // Re-derive studio film_numbers from the filmMap we built. Since we don't
      // store it in state, re-fetch from films table directly.
      const normS = normaliseStudio(batch.studio)
      let studioQ = supabase.from('films').select('film_number')
      if (normS === 'Independent') {
        studioQ = studioQ.in('studio', ['Independent', 'Other'])
      } else {
        studioQ = studioQ.ilike('studio', batch.studio.trim())
      }
      const { data: sFilms, error: sErr } = await studioQ
      if (sErr) throw sErr
      const filmNumbers = (sFilms ?? []).map(f => String(f.film_number))

      if (filmNumbers.length === 0) throw new Error('No film numbers found for this studio')

      // Delete in chunks of 500
      const CHUNK = 500
      const delFrom = async (table) => {
        for (let i = 0; i < filmNumbers.length; i += CHUNK) {
          const chunk = filmNumbers.slice(i, i + CHUNK)
          const { error } = await supabase
            .from(table)
            .delete()
            .eq('month_period', batch.month_period)
            .in('film_number', chunk)
          if (error) throw error
        }
      }

      if (batch.expenseCount > 0) await delFrom('actual_expenses')
      if (batch.incomeCount  > 0) await delFrom('rental_transactions')

      showToast('success', `Upload batch deleted successfully — ${batch.monthLabel} · ${batch.studio}`)
      await load()   // refresh list
    } catch (err) {
      console.error('[UploadsManager] delete error', err)
      showToast('error', `Deletion failed: ${err.message}`)
    }
    setDeleting(false)
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  const totalRows  = batches.reduce((s, b) => s + b.expenseCount + b.incomeCount, 0)

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 pt-12 backdrop-blur-sm"
         style={{ background: 'rgba(45,27,105,0.35)' }}>
      <div className="relative w-full max-w-3xl rounded-2xl border border-[rgba(74,20,140,0.18)] bg-white shadow-[0_32px_72px_rgba(74,20,140,0.24)]"
           style={{ maxHeight: '88vh', display: 'flex', flexDirection: 'column' }}>

        {/* ── Header ── */}
        <div className="flex shrink-0 items-center justify-between gap-4 border-b border-[rgba(74,20,140,0.1)] px-6 py-4">
          <div className="flex items-center gap-3">
            <History className="h-5 w-5 text-[#4B4594]" aria-hidden />
            <div>
              <h2 className="font-['Montserrat',sans-serif] text-base font-extrabold text-[#2D1B69]">Upload History</h2>
              <p className="text-[11px] text-[#9A8AB8]">
                {loading ? 'Loading…' : `${batches.length} batch${batches.length !== 1 ? 'es' : ''} · ${totalRows.toLocaleString()} total rows`}
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
            <p className="py-12 text-center text-sm text-[#C0B8D8]">No upload history found.</p>
          )}

          {!loading && batches.length > 0 && (
            <div className="space-y-2">
              {batches.map((batch) => {
                const key = `${batch.month_period}||${batch.studio}`
                const ts = batch.latestTs
                  ? new Date(batch.latestTs).toLocaleString('en-GB', {
                      day: '2-digit', month: '2-digit', year: 'numeric',
                      hour: '2-digit', minute: '2-digit',
                    })
                  : null

                return (
                  <div key={key}
                    className="flex items-center gap-3 rounded-xl border border-[rgba(74,20,140,0.1)] bg-[#FAFAFE] px-4 py-3 transition hover:border-[rgba(74,20,140,0.2)] hover:bg-white hover:shadow-sm">

                    {/* Month + Studio */}
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-['Montserrat',sans-serif] text-sm font-extrabold text-[#2D1B69]">
                          {batch.monthLabel}
                        </span>
                        <span className="rounded-md bg-[#EDE8F8] px-2 py-0.5 text-[10px] font-bold text-[#4A148C]">
                          {batch.studio}
                        </span>
                        {ts && (
                          <span className="text-[10px] text-[#B0A4CC]">{ts}</span>
                        )}
                      </div>

                      {/* Financial summary */}
                      <div className="mt-1.5 flex flex-wrap items-center gap-3">
                        {batch.expenseCount > 0 && (
                          <span className="flex items-center gap-1 text-[11px] font-semibold text-[#C0392B]">
                            <TrendingDown className="h-3 w-3" aria-hidden />
                            {batch.expenseCount} exp · {fmt(batch.expenseTotal)}
                          </span>
                        )}
                        {batch.incomeCount > 0 && (
                          <span className="flex items-center gap-1 text-[11px] font-semibold text-[#0EA5A0]">
                            <TrendingUp className="h-3 w-3" aria-hidden />
                            {batch.incomeCount} inc · {fmt(batch.incomeTotal)}
                          </span>
                        )}
                        {batch.expenseCount === 0 && batch.incomeCount === 0 && (
                          <span className="text-[11px] text-[#C0B8D8]">No rows</span>
                        )}
                      </div>
                    </div>

                    {/* Delete button */}
                    <button
                      type="button"
                      onClick={() => setConfirm(batch)}
                      disabled={deleting}
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[rgba(192,0,76,0.2)] bg-white text-[#C0004C] transition hover:bg-[#FFF1F3] disabled:opacity-40"
                      title="Delete this batch"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )
              })}
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
              Are you sure you want to delete the data for{' '}
              <strong>{confirm.monthLabel}</strong> at <strong>{confirm.studio}</strong>?
            </p>
            <p className="mb-4 text-sm text-[#5B4B7A]">
              This will permanently remove{' '}
              <strong>{(confirm.expenseCount + confirm.incomeCount).toLocaleString()} rows</strong>
              {confirm.expenseTotal + confirm.incomeTotal > 0 && (
                <> totalling <strong>{fmt(confirm.expenseTotal + confirm.incomeTotal)}</strong></>
              )}{' '}
              from the system. <span className="font-semibold text-[#C0004C]">This action cannot be undone.</span>
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
