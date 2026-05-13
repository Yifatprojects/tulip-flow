import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertCircle, ArrowLeft, ArrowUpDown, BookOpen, Calendar, CheckCircle2,
  ChevronDown, Clapperboard, DollarSign, Download, Edit2, Eye, EyeOff, Film,
  History, Loader2, LogOut, Plus, Receipt, Save, Search, Settings, TrendingUp, X,
} from 'lucide-react'
import * as XLSX from 'xlsx'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts'
import { supabase } from './lib/supabaseClient'
import tulipLogo from './assets/tulip-logo.png'
import { ExcelUploadButton } from './ExcelUpload'
import { FilmsManagementModal } from './FilmsManagement'
import { CatalogsManagementModal } from './CatalogsManagement'
import UploadsManagementModal from './UploadsManagement'
import { LoginPage } from './LoginPage'

/** @typedef {import('./types/movie').Movie} Movie */

/** Fixed studio name options — shared across the app */
const DEFAULT_STUDIO_OPTIONS = ['Universal', 'Paramount', 'Warner Bros.', 'Independent']

/** Normalize legacy DB value 'Other' → display as 'Independent' */
const normalizeStudio = (s) => (s === 'Other' ? 'Independent' : s ?? '')

/** Match filter: 'Independent' also catches legacy 'Other' rows in DB */
const studioMatches = (movieStudio, filter) => {
  const norm = normalizeStudio(String(movieStudio ?? '').trim())
  return filter === 'Independent' ? norm === 'Independent' || String(movieStudio ?? '').trim() === 'Other' : norm === filter
}

/** Primary display title: English, else Hebrew */
function movieTitleEnglish(movie) {
  const en = movie?.title_en?.trim()
  const he = movie?.title_he?.trim()
  return en || he || 'Untitled'
}

/** Hebrew subtitle shown below when both languages are set */
function movieTitleHebrewSubtitle(movie) {
  const en = movie?.title_en?.trim()
  const he = movie?.title_he?.trim()
  return en && he ? he : ''
}

/** Studio name and film_number, e.g. "Universal • WB001" */
function movieStudioAndCodeLabel(movie) {
  const studio = normalizeStudio(movie.studio?.trim())
  const code = movie.film_number?.trim()
  if (studio && code) return `${studio} • ${code}`
  if (code) return code
  if (studio) return studio
  return '—'
}

function formatMoney(value) {
  const n = Number(value)
  if (Number.isNaN(n)) return '—'
  return n.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

function formatReleaseDate(value) {
  if (value == null || value === '') return null
  // Try native parse first (handles ISO "2026-04-16")
  let d = new Date(value)
  if (!isNaN(d.getTime())) {
    // ISO date-only: treat as local midnight to avoid timezone shift
    if (/^\d{4}-\d{2}-\d{2}$/.test(String(value))) {
      const [y, m, day] = String(value).split('-').map(Number)
      d = new Date(y, m - 1, day)
    }
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
  }
  // Fallback: DD.MM.YY / DD/MM/YY / DD.MM.YYYY
  const match = String(value).match(/^(\d{1,2})[./](\d{1,2})[./](\d{2,4})$/)
  if (match) {
    let [, day, month, year] = match.map(Number)
    if (year < 100) year += 2000
    d = new Date(year, month - 1, day)
    if (!isNaN(d.getTime()))
      return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
  }
  return null
}

/** Soft glow: emerald when under budget, glowy red when over */
function varianceCellClass(v) {
  if (v < 0) return 'text-[#E61E6E] font-semibold'
  if (v > 0) return 'text-[#2FA36B] font-semibold'
  return 'text-[#6A5B88]'
}

function formatCurrency(value) {
  return `₪${formatMoney(value)}`
}


/** Shared KPI strip: budget (neutral), actual (bold), variance (green/red). */
function KpiSummaryCards({ totalBudget, totalActual, scopeLabel, className = 'mt-6' }) {
  const variance = totalBudget - totalActual
  const varianceNegative = variance < 0
  const variancePositive = variance > 0
  return (
    <div
      className={`grid grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-4 ${className}`}
    >
      <div className="flex min-w-0 flex-col overflow-hidden rounded-xl border border-[rgba(74,20,140,0.14)] bg-white/95 p-3 shadow-[0_8px_24px_rgba(74,20,140,0.08)] sm:p-4">
        <div className="min-h-[3.25rem] sm:min-h-[3.5rem]">
          <p className="text-[0.6rem] font-semibold uppercase leading-snug tracking-[0.14em] text-[#8A7BAB] sm:text-[0.65rem] sm:tracking-[0.16em]">
            Total budget
          </p>
        </div>
        <p className="mt-2 min-w-0 max-w-full font-['Montserrat',sans-serif] text-[clamp(0.875rem,2.4vw,1.25rem)] font-semibold tabular-nums leading-tight tracking-tight text-[#5B4B7A] sm:text-[clamp(0.9375rem,1.9vw,1.375rem)]">
          {formatCurrency(totalBudget)}
        </p>
        <p className="mt-1 text-[10px] text-[#9A8AB8] sm:text-[11px]">{scopeLabel}</p>
      </div>
      <div className="flex min-w-0 flex-col overflow-hidden rounded-xl border border-[rgba(74,20,140,0.14)] bg-white/95 p-3 shadow-[0_8px_24px_rgba(74,20,140,0.08)] sm:p-4">
        <div className="min-h-[3.25rem] sm:min-h-[3.5rem]">
          <p className="text-[0.6rem] font-semibold uppercase leading-snug tracking-[0.14em] text-[#8A7BAB] sm:text-[0.65rem] sm:tracking-[0.16em]">
            Total actual (spent)
          </p>
        </div>
        <p className="mt-2 min-w-0 max-w-full font-['Montserrat',sans-serif] text-[clamp(0.875rem,2.4vw,1.25rem)] font-extrabold tabular-nums leading-tight tracking-tight text-[#4A148C] sm:text-[clamp(0.9375rem,1.9vw,1.375rem)]">
          {formatCurrency(totalActual)}
        </p>
        <p className="mt-1 text-[10px] text-[#9A8AB8] sm:text-[11px]">{scopeLabel}</p>
      </div>
      <div
        className={`flex min-w-0 flex-col overflow-hidden rounded-xl border p-3 shadow-[0_8px_24px_rgba(74,20,140,0.08)] sm:p-4 ${
          varianceNegative
            ? 'border-red-200/80 bg-red-50/90'
            : variancePositive
              ? 'border-emerald-200/80 bg-emerald-50/90'
              : 'border-[rgba(74,20,140,0.14)] bg-white/95'
        }`}
      >
        <div className="min-h-[3.25rem] sm:min-h-[3.5rem]">
          <p className="text-[0.6rem] font-semibold uppercase leading-snug tracking-[0.14em] text-[#8A7BAB] sm:text-[0.65rem] sm:tracking-[0.16em]">
            Variance (remaining)
          </p>
        </div>
        <p
          className={`mt-2 min-w-0 max-w-full font-['Montserrat',sans-serif] text-[clamp(0.8125rem,2.3vw,1.2rem)] font-extrabold tabular-nums leading-tight tracking-tight sm:text-[clamp(0.875rem,1.85vw,1.3125rem)] ${
            varianceNegative
              ? 'text-[#C41E3A]'
              : variancePositive
                ? 'text-[#15803D]'
                : 'text-[#5B4B7A]'
          }`}
        >
          {formatCurrency(variance)}
        </p>
        <p className="mt-1 text-[10px] text-[#7C6D98] sm:text-[11px]">
          {varianceNegative ? 'Over budget' : variancePositive ? 'Under budget' : 'On budget'}
        </p>
      </div>
    </div>
  )
}

/**
 * Fetch budget vs actual figures for a single film, grouped by category text.
 * Queries the new `budgets` and `expenses` tables (both keyed by film_number).
 */
async function fetchBudgetRows(filmNumber) {
  const fullRes = await supabase
    .from('budgets')
    .select('id, budget_item_name, planned_amount, media_budget_code, vendor_name, is_media')
    .eq('film_number', filmNumber)
    .order('media_budget_code', { nullsFirst: false })

  let data, error
  if (fullRes.error) {
    const coreRes = await supabase
      .from('budgets')
      .select('id, budget_item_name, planned_amount, media_budget_code')
      .eq('film_number', filmNumber)
      .order('media_budget_code', { nullsFirst: false })
    data  = coreRes.data
    error = coreRes.error
  } else {
    data  = fullRes.data
    error = fullRes.error
  }

  if (error) throw new Error(error.message)

  return (data ?? []).map(b => ({
    id:           b.id,
    categoryName: b.budget_item_name?.trim() || 'Uncategorised',
    mediaCode:    b.media_budget_code?.trim() || '',
    vendorName:   b.vendor_name?.trim() || '',
    budget:       Number(b.planned_amount) || 0,
    isMedia:      b.is_media ?? null,
  }))
}

/**
 * Fetch actual expense rows for a film, joined with the expenses catalog
 * via priority_code to show expense_description and expense_type.
 */
/** priority_codes beginning with these prefixes are Print/Technical — never count against budget */
const PRINT_PREFIXES = ['950', '940', '930']
function isPrintCode(code) {
  const s = String(code ?? '')
  return PRINT_PREFIXES.some((p) => s.startsWith(p))
}

async function fetchActualExpensesRows(filmNumber) {
  const [txRes, catalogRes] = await Promise.all([
    supabase
      .from('actual_expenses')
      .select('month_period, actual_amount, priority_code, studio_name, is_print')
      .eq('film_number', filmNumber)
      .order('month_period'),
    supabase
      .from('expenses')
      .select('priority_code, expense_description, expense_type, media_budget_code'),
  ])

  if (txRes.error) throw new Error(txRes.error.message)

  const descMap = new Map()
  for (const r of catalogRes.data ?? []) {
    descMap.set(r.priority_code, {
      expense_description: r.expense_description,
      expense_type: r.expense_type,
      media_budget_code: r.media_budget_code,
    })
  }

  return (txRes.data ?? []).map((tx) => ({
    ...tx,
    expense_description:
      descMap.get(tx.priority_code)?.expense_description ?? tx.priority_code ?? '—',
    expense_type: descMap.get(tx.priority_code)?.expense_type ?? '—',
    media_budget_code: descMap.get(tx.priority_code)?.media_budget_code ?? '',
    // Always derive is_print from priority_code prefix (930/940/950) — DB column is unreliable for historical rows
    is_print: isPrintCode(tx.priority_code),
  }))
}

/**
 * Fetch rental income rows for a film, joined with the rentals catalog
 * via priority_code to show income_description instead of raw codes.
 */
async function fetchIncomeRows(filmNumber) {
  const [txRes, catalogRes] = await Promise.all([
    supabase
      .from('rental_transactions')
      .select('month_period, actual_amount, priority_code')
      .eq('film_number', filmNumber)
      .order('month_period'),
    supabase
      .from('rentals')
      .select('priority_code, income_description, format_type, reporting_code'),
  ])

  if (txRes.error) throw new Error(txRes.error.message)

  const descMap = new Map()
  for (const r of catalogRes.data ?? []) {
    descMap.set(r.priority_code, {
      income_description: r.income_description,
      format_type: r.format_type,
    })
  }

  return (txRes.data ?? []).map((tx) => ({
    ...tx,
    income_description:
      descMap.get(tx.priority_code)?.income_description ?? tx.priority_code ?? tx.reporting_code ?? '—',
    format_type: descMap.get(tx.priority_code)?.format_type ?? '—',
  }))
}

function SortableMovieCard({ movie, totalBudget, actualSpent, latestMonthExpenses, latestMonthIncome, latestMonthLabel, isSelected, onSelect }) {
  const rawRatio     = totalBudget > 0 ? (actualSpent / totalBudget) * 100 : actualSpent > 0 ? 100 : 0
  const barRatio     = Math.min(rawRatio, 100)   // bar width capped at 100%
  const spentRatio   = rawRatio                  // label shows real %, may exceed 100
  const isOverBudget = totalBudget > 0 && actualSpent > totalBudget
  const isAt80       = !isOverBudget && rawRatio > 80

  return (
    <button
      type="button"
      onClick={onSelect}
      className={`group relative w-full rounded-xl border p-3.5 text-left transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[rgba(75,69,148,0.5)] ${
        isSelected
          ? 'border-[rgba(249,178,51,0.75)] bg-white shadow-[0_0_0_1px_rgba(249,178,51,0.45),0_12px_28px_rgba(249,178,51,0.24)]'
          : 'border-[rgba(123,82,171,0.24)] bg-white hover:border-[rgba(249,178,51,0.6)] hover:bg-[#FFFDF6] hover:shadow-[0_10px_22px_rgba(123,82,171,0.14)]'
      }`}
    >
      {/* Title row */}
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-start gap-1.5">
            <h3 className="break-words font-['Montserrat',sans-serif] text-sm font-bold leading-snug text-[#F9B233]" dir="auto">
              {movieTitleEnglish(movie)}
            </h3>
            {isOverBudget && (
              <span className="shrink-0 self-start rounded-full bg-[#FFE5EC] px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-[#E61E6E] ring-1 ring-[#E61E6E]/30">
                Over Budget
              </span>
            )}
          </div>
          {movieTitleHebrewSubtitle(movie) && (
            <p className="mt-0.5 break-words text-[10px] leading-snug text-[#9A8AB8]" dir="rtl" lang="he">
              {movieTitleHebrewSubtitle(movie)}
            </p>
          )}
          <p className="mt-0.5 text-[10px] text-[#6A5B88]">{movieStudioAndCodeLabel(movie)}</p>
          {/* Profit center + release date chips */}
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            {movie.profit_center && (
              <span className="inline-flex items-center gap-1 rounded-md bg-[#EDE8F8] px-1.5 py-0.5 font-['JetBrains_Mono',ui-monospace,monospace] text-[9px] font-semibold text-[#4A148C]">
                PC {movie.profit_center}
              </span>
            )}
            {movie.profit_center_2 && (
              <span className="inline-flex items-center gap-1 rounded-md bg-[#EDE8F8] px-1.5 py-0.5 font-['JetBrains_Mono',ui-monospace,monospace] text-[9px] font-semibold text-[#4A148C]">
                PC2 {movie.profit_center_2}
              </span>
            )}
            {formatReleaseDate(movie.release_date) && (
              <span className="inline-flex items-center gap-1 rounded-md bg-[#FFF3E0] px-1.5 py-0.5 text-[9px] font-semibold text-[#E65100]">
                <Calendar className="h-2.5 w-2.5" aria-hidden />
                {formatReleaseDate(movie.release_date)}
              </span>
            )}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <p className="font-['Montserrat',sans-serif] text-sm font-bold tabular-nums text-[#4B4594]">
            {formatCurrency(totalBudget)}
          </p>
          <p className="text-[9px] text-[#8A7BAB]">Budget</p>
        </div>
      </div>

      {/* Progress bar — same colour logic as budget overview */}
      <div className="mb-1.5 h-2 w-full overflow-hidden rounded-full bg-[#EDE8F8]">
        <div
          className="h-full rounded-full transition-all"
          style={{
            width: `${barRatio}%`,
            background: isOverBudget
              ? 'linear-gradient(90deg,#E61E6E,#C0004C)'
              : isAt80
              ? 'linear-gradient(90deg,#F59E0B,#D97706)'
              : 'linear-gradient(90deg,#2FA36B,#0EA5A0)',
          }}
        />
      </div>

      {/* Spent / progress label */}
      <div className="mb-2 flex items-center justify-between text-[10px] text-[#8A7BAB]">
        <span>Spent <span className="font-semibold tabular-nums text-[#6A5B88]">{formatCurrency(actualSpent)}</span></span>
        <span
          className="font-semibold tabular-nums"
          style={{ color: isOverBudget ? '#C0004C' : isAt80 ? '#D97706' : '#2FA36B' }}
        >
          {spentRatio.toFixed(0)}%
        </span>
      </div>

      {/* Monthly snapshot */}
      {latestMonthLabel && (latestMonthExpenses > 0 || latestMonthIncome > 0) && (
        <div className="mt-1 flex items-center gap-2 rounded-lg bg-[#F7F4FC] px-2.5 py-1.5">
          <BookOpen className="h-3 w-3 shrink-0 text-[#4B4594]" aria-hidden />
          <span className="text-[9px] font-semibold uppercase tracking-[0.12em] text-[#8A7BAB]">{latestMonthLabel}</span>
          {latestMonthExpenses > 0 && (
            <span className="ml-auto text-[10px] font-semibold tabular-nums text-[#C0392B]">
              −{formatCurrency(latestMonthExpenses)}
            </span>
          )}
          {latestMonthIncome > 0 && (
            <span className="text-[10px] font-semibold tabular-nums text-[#0EA5A0]">
              +{formatCurrency(latestMonthIncome)}
            </span>
          )}
        </div>
      )}
    </button>
  )
}

// ── Trend chart (accumulated expenses + income over months) ──────────────────
function TrendChart({ filmNumber }) {
  const [chartData, setChartData] = useState(null)

  useEffect(() => {
    if (!filmNumber) return
    let cancelled = false
    async function load() {
      const [expRes, incRes] = await Promise.all([
        supabase.from('actual_expenses').select('month_period, actual_amount').eq('film_number', filmNumber).order('month_period'),
        supabase.from('rental_transactions').select('month_period, actual_amount').eq('film_number', filmNumber).order('month_period'),
      ])
      if (cancelled) return

      const months = [...new Set([
        ...(expRes.data ?? []).map(r => r.month_period),
        ...(incRes.data ?? []).map(r => r.month_period),
      ])].sort()

      if (months.length === 0) { setChartData([]); return }

      // Build monthly totals
      const expByMonth = {}
      for (const r of expRes.data ?? []) expByMonth[r.month_period] = (expByMonth[r.month_period] ?? 0) + Number(r.actual_amount)
      const incByMonth = {}
      for (const r of incRes.data ?? []) incByMonth[r.month_period] = (incByMonth[r.month_period] ?? 0) + Number(r.actual_amount)

      // Build accumulated series
      let accExp = 0, accInc = 0
      const data = months.map(m => {
        accExp += expByMonth[m] ?? 0
        accInc += incByMonth[m] ?? 0
        return {
          month: m.slice(0, 7), // YYYY-MM
          expenses: Math.round(accExp),
          income:   Math.round(accInc),
        }
      })
      setChartData(data)
    }
    void load()
    return () => { cancelled = true }
  }, [filmNumber])

  if (chartData === null) return (
    <div className="flex h-40 items-center justify-center">
      <Loader2 className="h-5 w-5 animate-spin text-[#4B4594]" />
    </div>
  )
  if (chartData.length === 0) return (
    <p className="py-6 text-center text-sm text-[#8A7BAB]">No monthly data yet.</p>
  )

  const fmt = (v) => `₪${(v / 1000).toFixed(0)}k`

  return (
    <ResponsiveContainer width="100%" height={200}>
      <LineChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(74,20,140,0.08)" />
        <XAxis dataKey="month" tick={{ fontSize: 10, fill: '#8A7BAB' }} tickLine={false} axisLine={false} />
        <YAxis tickFormatter={fmt} tick={{ fontSize: 10, fill: '#8A7BAB' }} tickLine={false} axisLine={false} width={44} />
        <Tooltip
          formatter={(val, name) => [`₪${Number(val).toLocaleString()}`, name === 'expenses' ? 'Accum. Expenses' : 'Accum. Revenue']}
          contentStyle={{ borderRadius: 10, border: '1px solid rgba(74,20,140,0.12)', fontSize: 12 }}
        />
        <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11, paddingTop: 8 }}
          formatter={(v) => v === 'expenses' ? 'Accum. Expenses' : 'Accum. Revenue'} />
        <Line type="monotone" dataKey="expenses" stroke="#C0392B" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
        <Line type="monotone" dataKey="income"   stroke="#0EA5A0" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
      </LineChart>
    </ResponsiveContainer>
  )
}

// ── Dashboard Summary Row ─────────────────────────────────────────────────────
function DashboardSummaryRow({ studioOptions = [] }) {
  const [summary, setSummary]             = useState(null)
  const [loading, setLoading]             = useState(false)
  const [summaryStudio, setSummaryStudio] = useState('') // '' = All Studios
  const [auditData, setAuditData]         = useState(null)
  const [auditLoading, setAuditLoading]   = useState(false)
  const [showAudit, setShowAudit]         = useState(false)
  // Drill-down modal state
  const [drilldown, setDrilldown]         = useState(null) // null | { type, rows, total, loading }

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      try {
        const now          = new Date()
        const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`
        const ytdStart     = `${now.getFullYear()}-01-01`

        // ── Fully client-side approach (mirrors the audit — guaranteed correct) ──
        // Fetch ALL films + ALL financial rows for the period, then filter in JS.
        // This avoids any server-side .in() type-mismatch or ilike issues that
        // caused Universal (and potentially other studios) to show ₪0.00.

        const normId = (v) => String(v ?? '').trim()
        const normSt = (s) => (s === 'Other' ? 'Independent' : (s ?? '').trim())

        // Helper: paginate through any Supabase query
        const fetchAllRows = async (baseQ, extraCols = '') => {
          const PAGE = 1000
          let rows = [], from = 0
          while (true) {
            const { data: page } = await baseQ.range(from, from + PAGE - 1)
            rows = rows.concat(page ?? [])
            if (!page || page.length < PAGE) break
            from += PAGE
          }
          return rows
        }

        // 1. Fetch ALL films → build filmMap keyed by film_number AND profit_center
        const allFilmsKPI = await fetchAllRows(
          supabase.from('films').select('film_number, profit_center, studio')
        )
        const filmMapKPI = {}
        for (const f of allFilmsKPI) {
          if (normId(f.film_number))   filmMapKPI[normId(f.film_number)]   = f
          if (normId(f.profit_center)) filmMapKPI[normId(f.profit_center)] = f
        }

        // 2. Fetch ALL financial rows for the period (no film filter)
        const [allCurrExp, allCurrInc, allYtdExp, allYtdInc] = await Promise.all([
          fetchAllRows(supabase.from('actual_expenses').select('film_number, actual_amount').eq('month_period', currentMonth)),
          fetchAllRows(supabase.from('rental_transactions').select('film_number, actual_amount').eq('month_period', currentMonth)),
          fetchAllRows(supabase.from('actual_expenses').select('film_number, actual_amount').gte('month_period', ytdStart).lte('month_period', currentMonth)),
          fetchAllRows(supabase.from('rental_transactions').select('film_number, actual_amount').gte('month_period', ytdStart).lte('month_period', currentMonth)),
        ])

        // 3. Filter client-side by studio (or include everything for "All Studios")
        const selectedLc = summaryStudio ? normSt(summaryStudio).toLowerCase() : null
        const matchesStudio = (row) => {
          if (!selectedLc) return true
          const film = filmMapKPI[normId(row.film_number)]
          return normSt(film?.studio ?? '').toLowerCase() === selectedLc
        }

        const sum = (rows) => rows.filter(matchesStudio).reduce((s, r) => s + Number(r.actual_amount), 0)
        if (!cancelled) setSummary({
          currExpenses: sum(allCurrExp), currIncome: sum(allCurrInc),
          ytdExpenses:  sum(allYtdExp),  ytdIncome:  sum(allYtdInc),
        })
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => { cancelled = true }
  }, [summaryStudio])

  // ── Data Audit ─────────────────────────────────────────────────────────────
  async function runAudit() {
    setAuditLoading(true)
    setShowAudit(true)
    try {
      const now          = new Date()
      const ytdStart     = `${now.getFullYear()}-01-01`
      const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`

      const norm = (v) => String(v ?? '').trim()

      // Fetch ALL films with pagination — Supabase default limit is 1000 rows,
      // so a single query silently truncates on large datasets (4000+ films).
      // We must page through to build a complete lookup map.
      const FILM_PAGE = 1000
      let allFilms = []
      let filmFrom = 0
      while (true) {
        const { data: page } = await supabase
          .from('films')
          .select('film_number, profit_center, title_en, title_he, studio')
          .range(filmFrom, filmFrom + FILM_PAGE - 1)
        allFilms = allFilms.concat(page ?? [])
        if (!page || page.length < FILM_PAGE) break
        filmFrom += FILM_PAGE
      }

      // Build a map keyed by BOTH film_number AND profit_center → same film object.
      // The journal import stores Column E (מרכז רווח / Profit Center) as
      // actual_expenses.film_number, so we must accept either identifier.
      const filmMap = {}
      for (const f of allFilms) {
        if (norm(f.film_number))   filmMap[norm(f.film_number)]   = f
        if (norm(f.profit_center)) filmMap[norm(f.profit_center)] = f
      }
      const knownSet = new Set(Object.keys(filmMap))

      // Fetch ALL expense & income rows (YTD) — no filter
      const [rawExp, rawInc] = await Promise.all([
        supabase.from('actual_expenses').select('film_number, actual_amount, month_period').gte('month_period', ytdStart).lte('month_period', currentMonth),
        supabase.from('rental_transactions').select('film_number, actual_amount, month_period').gte('month_period', ytdStart).lte('month_period', currentMonth),
      ])

      const allExp = rawExp.data ?? []
      const allInc = rawInc.data ?? []

      // Partition into known vs orphaned — normalise each row's film_number too
      const orphanedExp = allExp.filter(r => !knownSet.has(norm(r.film_number)))
      const orphanedInc = allInc.filter(r => !knownSet.has(norm(r.film_number)))
      const knownExp    = allExp.filter(r =>  knownSet.has(norm(r.film_number)))
      const knownInc    = allInc.filter(r =>  knownSet.has(norm(r.film_number)))

      const sumRows = (rows) => rows.reduce((s, r) => s + Number(r.actual_amount), 0)

      // Group orphaned by film_number
      const orphanByFilm = {}
      for (const r of [...orphanedExp, ...orphanedInc]) {
        const key = norm(r.film_number)
        if (!orphanByFilm[key]) orphanByFilm[key] = { exp: 0, inc: 0, rows: 0 }
        if (orphanedExp.includes(r)) orphanByFilm[key].exp += Number(r.actual_amount)
        else orphanByFilm[key].inc += Number(r.actual_amount)
        orphanByFilm[key].rows++
      }

      // Group known by studio — use the RAW studio value from DB to expose variants
      const byStudio = {}
      for (const r of knownExp) {
        const rawStudio = filmMap[norm(r.film_number)]?.studio?.trim() || '(blank)'
        byStudio[rawStudio] = byStudio[rawStudio] ?? { exp: 0, inc: 0, films: new Set() }
        byStudio[rawStudio].exp += Number(r.actual_amount)
        byStudio[rawStudio].films.add(norm(r.film_number))
      }
      for (const r of knownInc) {
        const rawStudio = filmMap[norm(r.film_number)]?.studio?.trim() || '(blank)'
        byStudio[rawStudio] = byStudio[rawStudio] ?? { exp: 0, inc: 0, films: new Set() }
        byStudio[rawStudio].inc += Number(r.actual_amount)
        byStudio[rawStudio].films.add(norm(r.film_number))
      }
      // Convert Sets to counts for serialization
      const byStudioOut = Object.fromEntries(
        Object.entries(byStudio).map(([k, v]) => [k, { exp: v.exp, inc: v.inc, filmCount: v.films.size }])
      )

      // Detect studio name variants that look like duplicates (case-insensitive)
      const studioVariants = {}
      for (const f of allFilms ?? []) {
        const raw = f.studio?.trim() || '(blank)'
        const key = raw.toLowerCase()
        studioVariants[key] = studioVariants[key] ?? []
        if (!studioVariants[key].includes(raw)) studioVariants[key].push(raw)
      }
      const duplicateVariants = Object.values(studioVariants).filter(v => v.length > 1)

      setAuditData({
        totalExp: sumRows(allExp), totalInc: sumRows(allInc),
        knownExp:  sumRows(knownExp),  knownInc:  sumRows(knownInc),
        orphanExpTotal: sumRows(orphanedExp), orphanIncTotal: sumRows(orphanedInc),
        orphanByFilm, byStudio: byStudioOut, duplicateVariants,
        orphanCount: orphanedExp.length + orphanedInc.length,
      })
    } finally {
      setAuditLoading(false)
    }
  }

  // ── Drill-down fetch ───────────────────────────────────────────────────────
  async function fetchDrilldown(type) {
    setDrilldown({ type, rows: [], total: 0, loading: true })

    try {
      const now          = new Date()
      const ytdStart     = `${now.getFullYear()}-01-01`
      const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`
      const currentYear  = now.getFullYear()

      const normId = (v) => String(v ?? '').trim()
      const normSt = (s) => (s === 'Other' ? 'Independent' : (s ?? '').trim())

      const pageAll = async (baseQ) => {
        const PAGE = 1000; let rows = [], from = 0
        while (true) {
          const { data } = await baseQ.range(from, from + PAGE - 1)
          rows = rows.concat(data ?? [])
          if (!data || data.length < PAGE) break
          from += PAGE
        }
        return rows
      }

      // 1. Fetch all films
      const allFilms = await pageAll(
        supabase.from('films').select('film_number, profit_center, title_en, title_he, studio')
      )
      const filmMap = {}
      for (const f of allFilms) {
        const entry = { title: f.title_en || f.title_he || f.film_number, studio: normSt(f.studio) }
        if (normId(f.film_number))   filmMap[normId(f.film_number)]   = entry
        if (normId(f.profit_center)) filmMap[normId(f.profit_center)] = entry
      }

      // 2. Fetch raw transactions
      let rawRows = []
      if (type === 'revenue') {
        rawRows = await pageAll(
          supabase.from('rental_transactions')
            .select('film_number, actual_amount, month_period')
            .gte('month_period', ytdStart)
            .lte('month_period', currentMonth)
        )
      } else {
        rawRows = await pageAll(
          supabase.from('actual_expenses')
            .select('film_number, actual_amount, month_period, is_print')
            .gte('month_period', ytdStart)
            .lte('month_period', currentMonth)
            .eq('is_print', false)
        )
      }

      // 3. Filter by selected studio, then aggregate by (month, studio)
      const aggMap = new Map() // key: `month||studio`
      for (const r of rawRows) {
        const studio = normSt(filmMap[normId(r.film_number)]?.studio ?? 'Unknown')
        if (summaryStudio && studio.toLowerCase() !== normSt(summaryStudio).toLowerCase()) continue
        const month = r.month_period?.substring(0, 7) ?? ''
        const key   = `${month}||${studio}`
        if (!aggMap.has(key)) aggMap.set(key, { month, studio, amount: 0, rows: 0 })
        const entry = aggMap.get(key)
        entry.amount += Number(r.actual_amount) || 0
        entry.rows++
      }

      const rows = [...aggMap.values()]
      // Sort: most recent month first, then studio alphabetically
      rows.sort((a, b) => b.month.localeCompare(a.month) || a.studio.localeCompare(b.studio))
      const total = rows.reduce((s, r) => s + r.amount, 0)
      setDrilldown({ type, rows, total, loading: false, year: currentYear })
    } catch (err) {
      console.error('[Drilldown] error', err)
      setDrilldown(null)
    }
  }

  const cards = [
    { label: 'Current Month Revenue',  value: summary?.currIncome   ?? 0, color: '#0EA5A0', icon: TrendingUp,  drillType: null },
    { label: 'Current Month Expenses', value: summary?.currExpenses ?? 0, color: '#C0392B', icon: Receipt,     drillType: null },
    { label: 'Revenue YTD',            value: summary?.ytdIncome    ?? 0, color: '#2FA36B', icon: DollarSign,  drillType: 'revenue' },
    { label: 'Expenses YTD',           value: summary?.ytdExpenses  ?? 0, color: '#7B52AB', icon: Film,        drillType: 'expenses' },
  ]

  return (
    <div className="mb-8">
      {/* ── Studio filter bar ── */}
      {studioOptions.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <span className="text-[0.6rem] font-bold uppercase tracking-[0.18em] text-[#8A7BAB]">Filter by Studio</span>
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => setSummaryStudio('')}
              className={`rounded-lg px-3 py-1 text-[11px] font-semibold transition-all ${
                summaryStudio === ''
                  ? 'bg-[#4A148C] text-white shadow-sm'
                  : 'border border-[rgba(74,20,140,0.18)] bg-white text-[#8A7BAB] hover:bg-[#F4F0FF] hover:text-[#4A148C]'
              }`}
            >
              All Studios
            </button>
            {studioOptions.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setSummaryStudio(s)}
                className={`rounded-lg px-3 py-1 text-[11px] font-semibold transition-all ${
                  summaryStudio === s
                    ? 'bg-[#4A148C] text-white shadow-sm'
                    : 'border border-[rgba(74,20,140,0.18)] bg-white text-[#8A7BAB] hover:bg-[#F4F0FF] hover:text-[#4A148C]'
                }`}
              >
                {s}
              </button>
            ))}
          </div>
          {summaryStudio && (
            <button
              type="button"
              onClick={() => setSummaryStudio('')}
              className="ml-1 flex items-center gap-1 rounded-lg border border-[rgba(198,40,40,0.2)] bg-[#FFF5F5] px-2 py-1 text-[10px] font-semibold text-[#C62828] transition hover:bg-[#FFEBEE]"
            >
              <X className="h-3 w-3" aria-hidden /> Clear Filter
            </button>
          )}
          {/* Audit trigger */}
          <button
            type="button"
            onClick={() => showAudit ? setShowAudit(false) : runAudit()}
            className="ml-auto flex items-center gap-1.5 rounded-lg border border-[rgba(74,20,140,0.18)] bg-white px-2.5 py-1 text-[10px] font-semibold text-[#8A7BAB] transition hover:bg-[#F4F0FF] hover:text-[#4A148C]"
            title="Audit data consistency"
          >
            <Receipt className="h-3 w-3" aria-hidden />
            {showAudit ? 'Hide Audit' : 'Audit Data'}
          </button>
        </div>
      )}

      {/* ── KPI cards ── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {cards.map(({ label, value, color, icon: Icon, drillType }) => {
          const isClickable = !!drillType
          return (
            <div
              key={label}
              onClick={isClickable ? () => fetchDrilldown(drillType) : undefined}
              role={isClickable ? 'button' : undefined}
              tabIndex={isClickable ? 0 : undefined}
              onKeyDown={isClickable ? (e) => e.key === 'Enter' && fetchDrilldown(drillType) : undefined}
              title={isClickable ? `Click to see breakdown` : undefined}
              className={`rounded-xl border border-[rgba(74,20,140,0.12)] bg-white p-3.5 shadow-[0_6px_20px_rgba(74,20,140,0.07)] transition
                ${isClickable ? 'cursor-pointer hover:border-[rgba(74,20,140,0.28)] hover:shadow-[0_8px_28px_rgba(74,20,140,0.13)] hover:ring-1 hover:ring-[rgba(74,20,140,0.12)]' : ''}`}
            >
              <div className="mb-2 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <div className="flex h-7 w-7 items-center justify-center rounded-lg" style={{ background: `${color}18` }}>
                    <Icon className="h-3.5 w-3.5" style={{ color }} aria-hidden />
                  </div>
                  <p className="text-[0.6rem] font-semibold uppercase tracking-[0.16em] text-[#8A7BAB]">{label}</p>
                </div>
                {isClickable && (
                  <span className="rounded-md border border-[rgba(74,20,140,0.14)] bg-[#F4F0FF] px-1.5 py-0.5 text-[9px] font-semibold text-[#8A7BAB]">
                    Drill ↗
                  </span>
                )}
              </div>
              {loading ? (
                <div className="mt-1 h-5 w-24 animate-pulse rounded bg-[#EDE8F8]" />
              ) : (
                <p className="font-['Montserrat',sans-serif] text-lg font-extrabold tabular-nums" style={{ color }}>
                  {formatCurrency(value)}
                </p>
              )}
            </div>
          )
        })}
      </div>

      {/* ── Data Audit Panel ── */}
      {showAudit && (
        <div className="mt-4 rounded-2xl border border-[rgba(74,20,140,0.2)] bg-white shadow-md overflow-hidden">
          <div className="flex items-center justify-between border-b border-[rgba(74,20,140,0.1)] bg-[#F7F2FF] px-4 py-3">
            <div className="flex items-center gap-2">
              <Receipt className="h-4 w-4 text-[#4A148C]" aria-hidden />
              <span className="text-[0.65rem] font-bold uppercase tracking-[0.18em] text-[#4A148C]">Data Consistency Audit — YTD</span>
            </div>
            <button type="button" onClick={() => setShowAudit(false)} className="text-[#8A7BAB] hover:text-[#4A148C]">
              <X className="h-4 w-4" />
            </button>
          </div>

          {auditLoading ? (
            <div className="flex items-center justify-center gap-2 py-8 text-sm text-[#8A7BAB]">
              <Loader2 className="h-4 w-4 animate-spin" /> Running audit…
            </div>
          ) : auditData ? (
            <div className="p-4 space-y-4">

              {/* ── Totals comparison ── */}
              <div className="grid grid-cols-3 gap-3">
                {[
                  { label: 'Raw DB Total (expenses)', value: auditData.totalExp,   note: 'all rows, no filter',         color: '#C0392B' },
                  { label: 'Known Films Total',        value: auditData.knownExp,  note: 'films present in films table', color: '#2FA36B' },
                  { label: 'Orphaned (gap)',            value: auditData.orphanExpTotal, note: 'no matching film in DB',   color: auditData.orphanExpTotal > 0 ? '#E65100' : '#2FA36B' },
                ].map(({ label, value, note, color }) => (
                  <div key={label} className="rounded-xl border border-[rgba(74,20,140,0.1)] bg-[#FAFAFA] px-3 py-2.5">
                    <p className="text-[0.55rem] font-bold uppercase tracking-[0.14em] text-[#8A7BAB]">{label}</p>
                    <p className="mt-0.5 font-['Montserrat',sans-serif] text-base font-extrabold tabular-nums" style={{ color }}>{formatCurrency(value)}</p>
                    <p className="text-[9px] text-[#A09ABB]">{note}</p>
                  </div>
                ))}
              </div>

              {/* ── Studio name variant warning ── */}
              {auditData.duplicateVariants?.length > 0 && (
                <div className="rounded-xl border border-[rgba(230,81,0,0.25)] bg-[#FFF8F5] px-4 py-3">
                  <p className="mb-1.5 text-[0.6rem] font-bold uppercase tracking-[0.14em] text-[#E65100]">
                    ⚠ Studio name inconsistencies detected
                  </p>
                  <p className="mb-2 text-[10px] text-[#B34700]">
                    These studio names look like the same studio but are stored differently in your database. This causes the studio filter to miss records.
                  </p>
                  {auditData.duplicateVariants.map((variants, i) => (
                    <div key={i} className="mb-1 flex flex-wrap items-center gap-1.5">
                      <span className="text-[10px] text-[#8A7BAB]">Variants:</span>
                      {variants.map(v => (
                        <span key={v} className="rounded bg-[#FFE0CC] px-1.5 py-0.5 font-['JetBrains_Mono',ui-monospace,monospace] text-[10px] font-semibold text-[#B34700]">
                          "{v}"
                        </span>
                      ))}
                    </div>
                  ))}
                  <p className="mt-2 text-[10px] text-[#E65100]">Fix: standardise these in Supabase or via the Films Management page.</p>
                </div>
              )}

              {/* ── Breakdown by studio (raw DB values) ── */}
              {Object.keys(auditData.byStudio).length > 0 && (
                <div>
                  <p className="mb-1 text-[0.6rem] font-bold uppercase tracking-[0.16em] text-[#4A148C]">Expenses by studio</p>
                  <p className="mb-2 text-[9px] text-[#8A7BAB]">Showing exact studio values as stored in the database — inconsistencies split into separate rows.</p>
                  <div className="overflow-hidden rounded-xl border border-[rgba(74,20,140,0.1)]">
                    <table className="w-full text-xs">
                      <thead className="bg-[#F7F2FF]">
                        <tr>
                          {['Studio (raw DB value)', 'Films', 'Expenses (YTD)', 'Revenue (YTD)'].map(h => (
                            <th key={h} className="px-3 py-2 text-left text-[0.6rem] font-bold uppercase tracking-[0.12em] text-[#8A7BAB]">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {Object.entries(auditData.byStudio).sort(([a],[b]) => a.localeCompare(b)).map(([studio, { exp, inc, filmCount }]) => (
                          <tr key={studio} className="border-t border-[rgba(74,20,140,0.06)]">
                            <td className="px-3 py-2 font-['JetBrains_Mono',ui-monospace,monospace] font-semibold text-[#2D1B69]">"{studio}"</td>
                            <td className="px-3 py-2 text-[#8A7BAB]">{filmCount}</td>
                            <td className="px-3 py-2 font-['Montserrat',sans-serif] tabular-nums text-[#C0392B]">{exp > 0 ? formatCurrency(exp) : '—'}</td>
                            <td className="px-3 py-2 font-['Montserrat',sans-serif] tabular-nums text-[#0EA5A0]">{inc > 0 ? formatCurrency(inc) : '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* ── Orphaned records ── */}
              {auditData.orphanCount === 0 ? (
                <div className="flex items-center gap-2 rounded-xl bg-[#F0FBF5] px-4 py-3 text-sm font-semibold text-[#2FA36B]">
                  <span>✓</span> No orphaned records found — all financial data is linked to known films.
                </div>
              ) : (
                <div>
                  <p className="mb-2 text-[0.6rem] font-bold uppercase tracking-[0.16em] text-[#E65100]">
                    ⚠ Orphaned records — {auditData.orphanCount} rows with unrecognised film numbers
                  </p>
                  <div className="overflow-hidden rounded-xl border border-[rgba(230,81,0,0.2)] bg-[#FFF8F5]">
                    <table className="w-full text-xs">
                      <thead className="bg-[#FFF0E6]">
                        <tr>
                          {['Film Number (not in films table)', 'Expenses', 'Revenue', 'Rows'].map(h => (
                            <th key={h} className="px-3 py-2 text-left text-[0.6rem] font-bold uppercase tracking-[0.12em] text-[#E65100]">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {Object.entries(auditData.orphanByFilm).sort(([,a],[,b]) => (b.exp+b.inc)-(a.exp+a.inc)).map(([fn, { exp, inc, rows }]) => (
                          <tr key={fn} className="border-t border-[rgba(230,81,0,0.1)]">
                            <td className="px-3 py-2 font-['JetBrains_Mono',ui-monospace,monospace] font-semibold text-[#B34700]">{fn}</td>
                            <td className="px-3 py-2 font-['Montserrat',sans-serif] tabular-nums text-[#C0392B]">{exp > 0 ? formatCurrency(exp) : '—'}</td>
                            <td className="px-3 py-2 font-['Montserrat',sans-serif] tabular-nums text-[#0EA5A0]">{inc > 0 ? formatCurrency(inc) : '—'}</td>
                            <td className="px-3 py-2 text-[#A09ABB]">{rows}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="mt-2 text-[10px] text-[#E65100]">
                    These records were excluded from the summary cards above. They exist in your financial tables but have no matching film in the films table — likely from a deleted or renamed film, or a test import.
                  </p>
                </div>
              )}
            </div>
          ) : null}
        </div>
      )}

      {/* ── Drill-down modal ── */}
      {drilldown && (() => {
        const isRevenue = drilldown.type === 'revenue'
        const accentColor = isRevenue ? '#2FA36B' : '#7B52AB'
        const accentLight = isRevenue ? '#F0FBF5' : '#F4F0FF'
        return (
          <div
            className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 pt-10"
            style={{ background: 'rgba(30,16,74,0.55)', backdropFilter: 'blur(6px)' }}
            onClick={() => setDrilldown(null)}
          >
            <div
              className="relative w-full max-w-2xl overflow-hidden rounded-2xl"
              style={{
                maxHeight: '88vh', display: 'flex', flexDirection: 'column',
                background: 'rgba(255,255,255,0.97)',
                border: '1px solid rgba(74,20,140,0.14)',
                boxShadow: '0 40px 80px rgba(30,16,74,0.30), 0 0 0 1px rgba(255,255,255,0.6) inset',
              }}
              onClick={e => e.stopPropagation()}
            >
              {/* ── Modal header ── */}
              <div className="flex shrink-0 items-center justify-between gap-4 px-6 py-5"
                   style={{ borderBottom: '1px solid rgba(74,20,140,0.08)' }}>
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-xl"
                       style={{ background: accentLight }}>
                    {isRevenue
                      ? <TrendingUp className="h-4 w-4" style={{ color: accentColor }} />
                      : <Receipt className="h-4 w-4" style={{ color: accentColor }} />}
                  </div>
                  <div>
                    <h2 className="font-['Montserrat',sans-serif] text-[15px] font-extrabold text-[#2D1B69]">
                      {isRevenue ? 'Revenue' : 'Expenses'} YTD {drilldown.year}
                    </h2>
                    <p className="mt-0.5 text-[11px] text-[#9A8AB8]">
                      {summaryStudio || 'All Studios'} · Jan 1 – present
                    </p>
                  </div>
                </div>
                <button type="button" onClick={() => setDrilldown(null)}
                  className="flex h-8 w-8 items-center justify-center rounded-full text-[#9A8AB8] transition hover:bg-[#F0EBFF] hover:text-[#4A148C]">
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* ── Table body (scrollable) ── */}
              <div className="flex-1 overflow-y-auto">
                {drilldown.loading ? (
                  <div className="flex items-center justify-center py-16">
                    <Loader2 className="h-7 w-7 animate-spin text-[#4B4594]" />
                  </div>
                ) : drilldown.rows.length === 0 ? (
                  <p className="py-12 text-center text-sm text-[#C0B8D8]">No data found for this period.</p>
                ) : (
                  <table className="w-full border-collapse" style={{ tableLayout: 'fixed' }}>
                    <colgroup>
                      <col style={{ width: '120px' }} />
                      <col />
                      <col style={{ width: '160px' }} />
                    </colgroup>

                    {/* Sticky header with frosted backing */}
                    <thead>
                      <tr style={{
                        position: 'sticky', top: 0, zIndex: 10,
                        background: 'rgba(247,244,251,0.92)',
                        backdropFilter: 'blur(8px)',
                        borderBottom: '1px solid rgba(74,20,140,0.1)',
                      }}>
                        <th className="py-3 pl-6 pr-4 text-left text-[0.58rem] font-bold uppercase tracking-[0.18em] text-[#8A7BAB]">Month</th>
                        <th className="px-4 py-3 text-left text-[0.58rem] font-bold uppercase tracking-[0.18em] text-[#8A7BAB]">Studio</th>
                        <th className="py-3 pl-4 pr-6 text-right text-[0.58rem] font-bold uppercase tracking-[0.18em] text-[#8A7BAB]">Amount</th>
                      </tr>
                    </thead>

                    <tbody>
                      {drilldown.rows.map((row, i) => (
                        <tr key={i}
                          style={{ background: i % 2 === 0 ? 'white' : 'rgba(247,244,251,0.45)' }}
                          className="transition-colors duration-100 hover:bg-[#EDE8F8]/60"
                        >
                          <td className="py-3 pl-6 pr-4 font-['JetBrains_Mono',ui-monospace,monospace] text-[13px] font-semibold tabular-nums text-[#2D1B69]">
                            {row.month}
                          </td>
                          <td className="px-4 py-3">
                            <span className="inline-block rounded-md px-2.5 py-0.5 text-[11px] font-bold"
                              style={{ background: accentLight, color: accentColor }}>
                              {row.studio}
                            </span>
                          </td>
                          <td className="py-3 pl-4 pr-6 text-right font-['JetBrains_Mono',ui-monospace,monospace] text-[13px] font-bold tabular-nums"
                              style={{ color: accentColor }}>
                            {formatCurrency(row.amount)}
                          </td>
                        </tr>
                      ))}

                      {/* Grand Total row */}
                      <tr style={{
                        borderTop: '2px solid rgba(74,20,140,0.15)',
                        background: accentLight,
                      }}>
                        <td className="py-3.5 pl-6 pr-4 text-[12px] font-extrabold uppercase tracking-[0.1em] text-[#2D1B69]">
                          Grand Total
                        </td>
                        <td className="px-4 py-3.5" />
                        <td className="py-3.5 pl-4 pr-6 text-right font-['JetBrains_Mono',ui-monospace,monospace] text-base font-extrabold tabular-nums"
                            style={{ color: accentColor }}>
                          {formatCurrency(drilldown.total)}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </div>
        )
      })()}
    </div>
  )
}

export default function App() {
  // ── auth ──────────────────────────────────────────────────────────────────
  // undefined = still loading, null = signed out, object = signed in
  const [session, setSession] = useState(undefined)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session: s } }) => setSession(s ?? null))
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => setSession(s ?? null))
    return () => subscription.unsubscribe()
  }, [])

  const [movies, setMovies] = useState(null)
  const [movieBudgetTotals, setMovieBudgetTotals] = useState({})
  const [movieActualTotals, setMovieActualTotals] = useState({})
  const [movieIncomeTotals, setMovieIncomeTotals]     = useState({})
  const [movieMarketingTotals, setMovieMarketingTotals] = useState({})
  const [movieLatestMonth, setMovieLatestMonth] = useState({})      // film_number → 'YYYY-MM-01'
  const [movieMonthlyExp,  setMovieMonthlyExp]  = useState({})      // film_number → expenses that month
  const [movieMonthlyInc,  setMovieMonthlyInc]  = useState({})      // film_number → income that month
  const [loadError, setLoadError] = useState(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [searchResults, setSearchResults] = useState([])
  const [searchLoading, setSearchLoading] = useState(false)
  const [studioFilter, setStudioFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('') // '' | 'plan_pre' | 'screening_post' | 'final' | 'approved' | 'overspend' | 'underspend'
  const [progressSort, setProgressSort] = useState('none')
  const [hideNoData, setHideNoData] = useState(true)
  const [adminMenuOpen, setAdminMenuOpen] = useState(false)
  const [filmsManagerOpen, setFilmsManagerOpen] = useState(false)
  const [catalogsManagerOpen, setCatalogsManagerOpen] = useState(null) // null | 'expenses' | 'rentals'
  const [uploadsManagerOpen, setUploadsManagerOpen]   = useState(false)
  const adminMenuRef = useRef(null)
  // Catalog-import gate: 'locked' | 'challenging' | 'unlocked'
  const [catalogImportGate, setCatalogImportGate] = useState('locked')
  const [catalogImportPwInput, setCatalogImportPwInput] = useState('')
  const [catalogImportPwError, setCatalogImportPwError] = useState('')

  // ── Dashboard widgets ──────────────────────────────────────────────────────
  const [lastUpdateInfo, setLastUpdateInfo] = useState(null) // array of { studio, period } | null

  useEffect(() => {
    async function fetchLastUpdate() {
      try {
        // 1. Load all films to build film_number/profit_center → studio map
        const filmMap = new Map() // norm(key) → studio label
        let page = 0
        while (true) {
          const { data } = await supabase.from('films')
            .select('film_number, profit_center, profit_center_2, studio')
            .range(page * 1000, page * 1000 + 999)
          if (!data || data.length === 0) break
          for (const f of data) {
            const studio = f.studio === 'Other' ? 'Independent' : (f.studio ?? 'Unknown')
            if (f.film_number)   filmMap.set(String(f.film_number).trim(),   studio)
            if (f.profit_center) filmMap.set(String(f.profit_center).trim(), studio)
            if (f.profit_center_2) filmMap.set(String(f.profit_center_2).trim(), studio)
          }
          if (data.length < 1000) break
          page++
        }

        // 2. Fetch last ~500 rows from each table (enough to cover all studios)
        const [expRes, rentRes] = await Promise.all([
          supabase.from('actual_expenses').select('film_number, month_period').order('month_period', { ascending: false }).limit(500),
          supabase.from('rental_transactions').select('film_number, month_period').order('month_period', { ascending: false }).limit(500),
        ])

        // 3. Track max period per studio
        const maxByStudio = new Map() // studio → max month_period string
        for (const row of [...(expRes.data ?? []), ...(rentRes.data ?? [])]) {
          const studio = filmMap.get(String(row.film_number ?? '').trim()) ?? null
          if (!studio) continue
          const cur = maxByStudio.get(studio)
          if (!cur || row.month_period > cur) maxByStudio.set(studio, row.month_period)
        }

        if (maxByStudio.size === 0) return

        const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
        const toLabel = (mp) => {
          const [yr, mo] = (mp ?? '').split('-')
          return MONTHS[Number(mo) - 1] ? `${MONTHS[Number(mo) - 1]} ${yr}` : mp
        }

        // 4. Build sorted array (most-recent period first)
        const result = [...maxByStudio.entries()]
          .map(([studio, mp]) => ({ studio, period: toLabel(mp), raw: mp }))
          .sort((a, b) => (b.raw > a.raw ? 1 : -1))

        setLastUpdateInfo(result)
      } catch { /* silent */ }
    }
    void fetchLastUpdate()
  }, [])

  const [selectedMovie, setSelectedMovie] = useState(null)

  // Lock body scroll while the budget overview is open so the browser-level
  // scrollbar doesn't show through the fixed overlay
  useEffect(() => {
    if (selectedMovie) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => { document.body.style.overflow = '' }
  }, [selectedMovie])

  const [budgetRows, setBudgetRows] = useState([])
  const [budgetLoading, setBudgetLoading] = useState(false)
  const [budgetError, setBudgetError] = useState(null)
  const [budgetRefresh, setBudgetRefresh] = useState(0)
  const [expandedGroups, setExpandedGroups] = useState(new Set())
  const [budgetFilter, setBudgetFilter] = useState('all') // 'all' | 'media' | 'nonmedia'
  const [budgetEditMode, setBudgetEditMode] = useState(false)
  const [draftRows, setDraftRows] = useState([])
  const [budgetSaving, setBudgetSaving] = useState(false)
  const [budgetSaveToast, setBudgetSaveToast] = useState(null) // 'success' | 'error' | null
  const [budgetStatusSaving, setBudgetStatusSaving] = useState(false)

  const [actualExpensesRows, setActualExpensesRows] = useState([])
  const [actualExpensesLoading, setActualExpensesLoading] = useState(false)
  const [actualExpensesError, setActualExpensesError] = useState(null)

  const [incomeRows, setIncomeRows] = useState([])
  const [incomeLoading, setIncomeLoading] = useState(false)
  const [incomeError, setIncomeError] = useState(null)

  const [addMovieOpen, setAddMovieOpen] = useState(false)
  const [newMovieHebrew, setNewMovieHebrew] = useState('')
  const [newMovieEnglish, setNewMovieEnglish] = useState('')
  const [newMovieCode, setNewMovieCode] = useState('')
  const [newMovieProfitCenter, setNewMovieProfitCenter] = useState('')
  const [newMovieProfitCenter2, setNewMovieProfitCenter2] = useState('')
  const [newMovieStudio, setNewMovieStudio] = useState(DEFAULT_STUDIO_OPTIONS[0])
  const [newMovieReleaseDate, setNewMovieReleaseDate] = useState('')
  const [addMovieBusy, setAddMovieBusy] = useState(false)
  const [addMovieError, setAddMovieError] = useState(null)


  const refreshMovies = useCallback(async () => {
    try {
      const [budgetRes, actualRes, rentalRes] = await Promise.allSettled([
        supabase.from('budgets').select('film_number, planned_amount'),
        supabase.from('actual_expenses').select('film_number, actual_amount, month_period, priority_code, is_print'),
        supabase.from('rental_transactions').select('film_number, actual_amount, month_period'),
      ])

      // Budget totals
      const budgetTotals = {}
      const budgetedFns = new Set()
      for (const row of (budgetRes.status === 'fulfilled' ? budgetRes.value.data : null) ?? []) {
        if (!row.film_number) continue
        budgetedFns.add(row.film_number)
        const amt = Number(row.planned_amount) || Number(row.amount) || 0
        budgetTotals[row.film_number] = (budgetTotals[row.film_number] ?? 0) + amt
      }

      // Actual expense totals + per-film monthly breakdown
      const actualTotals     = {}   // all expenses (including print)
      const marketingTotals  = {}   // only non-print expenses (for progress bar)
      const latestMonthByFilm = {}
      const monthlyExpByFilm  = {}
      for (const row of (actualRes.status === 'fulfilled' ? actualRes.value.data : null) ?? []) {
        if (!row.film_number) continue
        const isPrint = isPrintCode(row.priority_code)
        const amt = Number(row.actual_amount) || 0
        actualTotals[row.film_number] = (actualTotals[row.film_number] ?? 0) + amt
        if (!isPrint) {
          marketingTotals[row.film_number] = (marketingTotals[row.film_number] ?? 0) + amt
        }
        if (row.month_period) {
          if (!latestMonthByFilm[row.film_number] || row.month_period > latestMonthByFilm[row.film_number]) {
            latestMonthByFilm[row.film_number] = row.month_period
          }
          if (!monthlyExpByFilm[row.film_number]) monthlyExpByFilm[row.film_number] = {}
          const mp = monthlyExpByFilm[row.film_number]
          mp[row.month_period] = (mp[row.month_period] ?? 0) + (Number(row.actual_amount) || 0)
        }
      }

      // Income totals + per-film monthly breakdown
      const incomeTotals = {}
      const monthlyIncByFilm = {}
      for (const row of (rentalRes.status === 'fulfilled' ? rentalRes.value.data : null) ?? []) {
        if (!row.film_number) continue
        incomeTotals[row.film_number] = (incomeTotals[row.film_number] ?? 0) + (Number(row.actual_amount) || 0)
        if (row.month_period) {
          if (!latestMonthByFilm[row.film_number] || row.month_period > latestMonthByFilm[row.film_number]) {
            latestMonthByFilm[row.film_number] = row.month_period
          }
          if (!monthlyIncByFilm[row.film_number]) monthlyIncByFilm[row.film_number] = {}
          const mp = monthlyIncByFilm[row.film_number]
          mp[row.month_period] = (mp[row.month_period] ?? 0) + (Number(row.actual_amount) || 0)
        }
      }

      // Latest-month snapshot per film
      const snapExp = {}, snapInc = {}
      for (const [fn, latestMonth] of Object.entries(latestMonthByFilm)) {
        snapExp[fn] = monthlyExpByFilm[fn]?.[latestMonth] ?? 0
        snapInc[fn] = monthlyIncByFilm[fn]?.[latestMonth] ?? 0
      }

      // Fetch film details for films with any budget or journal data
      const uniqueFns = [...new Set([...budgetedFns, ...Object.keys(actualTotals), ...Object.keys(incomeTotals)])]
      let filmsData = []
      if (uniqueFns.length > 0) {
        let from = 0
        const PAGE = 1000
        while (true) {
          const { data: page, error: pageErr } = await supabase
            .from('films').select('*').in('film_number', uniqueFns).order('title_en').range(from, from + PAGE - 1)
          if (pageErr) throw pageErr
          filmsData = filmsData.concat(page ?? [])
          if (!page || page.length < PAGE) break
          from += PAGE
        }
      }

      setLoadError(null)
      setMovies(filmsData)
      setMovieBudgetTotals(budgetTotals)
      setMovieActualTotals(actualTotals)
      setMovieMarketingTotals(marketingTotals)
      setMovieIncomeTotals(incomeTotals)
      setMovieLatestMonth(latestMonthByFilm)
      setMovieMonthlyExp(snapExp)
      setMovieMonthlyInc(snapInc)
    } catch (err) {
      console.error(err)
      setLoadError(err instanceof Error ? err.message : String(err))
      setMovies([])
      setMovieBudgetTotals({})
      setMovieActualTotals({})
    }
  }, [])

  useEffect(() => {
    void refreshMovies()
  }, [refreshMovies])

  useEffect(() => {
    if (!selectedMovie) {
      setBudgetRows([])
      setBudgetError(null)
      setBudgetEditMode(false)
      setDraftRows([])
      setBudgetSaveToast(null)
      setBudgetStatusSaving(false)
      setActualExpensesRows([])
      setActualExpensesError(null)
      setIncomeRows([])
      setIncomeError(null)
      setExpandedGroups(new Set())
      setBudgetFilter('all')
      return
    }

    let cancelled = false

    async function load() {
      setBudgetLoading(true)
      setBudgetError(null)
      setActualExpensesLoading(true)
      setActualExpensesError(null)
      setIncomeLoading(true)
      setIncomeError(null)

      const [budgetResult, actualExpResult, incomeResult] = await Promise.allSettled([
        fetchBudgetRows(selectedMovie.film_number),
        fetchActualExpensesRows(selectedMovie.film_number),
        fetchIncomeRows(selectedMovie.film_number),
      ])

      if (cancelled) return

      if (budgetResult.status === 'fulfilled') {
        const rows = budgetResult.value
        setBudgetRows(rows)
        // Start with all groups expanded
        const keys = new Set(rows.map(r => r.mediaCode || '__none__'))
        setExpandedGroups(keys)
      } else {
        console.error(budgetResult.reason)
        setBudgetError(budgetResult.reason?.message ?? 'Failed to load budget')
        setBudgetRows([])
      }

      if (actualExpResult.status === 'fulfilled') {
        setActualExpensesRows(actualExpResult.value)
      } else {
        console.error(actualExpResult.reason)
        setActualExpensesError(actualExpResult.reason?.message ?? 'Failed to load actual expenses')
        setActualExpensesRows([])
      }

      if (incomeResult.status === 'fulfilled') {
        setIncomeRows(incomeResult.value)
      } else {
        console.error(incomeResult.reason)
        setIncomeError(incomeResult.reason?.message ?? 'Failed to load income')
        setIncomeRows([])
      }

      setBudgetLoading(false)
      setActualExpensesLoading(false)
      setIncomeLoading(false)
    }

    load()
    return () => { cancelled = true }
  }, [selectedMovie, budgetRefresh])


  // Debounced server-side search across all films (fires 350 ms after the user stops typing)
  useEffect(() => {
    const needle = searchTerm.trim()
    if (!needle) {
      setSearchResults([])
      setSearchLoading(false)
      return
    }
    setSearchLoading(true)
    const timer = setTimeout(async () => {
      try {
        const { data } = await supabase
          .from('films')
          .select('film_number, title_en, title_he, studio, profit_center, profit_center_2, release_date')
          .or(`title_en.ilike.%${needle}%,title_he.ilike.%${needle}%,film_number.ilike.%${needle}%,studio.ilike.%${needle}%,profit_center.ilike.%${needle}%,profit_center_2.ilike.%${needle}%`)
          .order('title_en')
          .limit(50)
        setSearchResults(data ?? [])
      } catch {
        setSearchResults([])
      } finally {
        setSearchLoading(false)
      }
    }, 350)
    return () => clearTimeout(timer)
  }, [searchTerm])


  const brandBorder = 'border border-[rgba(74,20,140,0.2)]'

  const codeTagClass = `rounded ${brandBorder} bg-white/90 px-1.5 py-0.5 font-['JetBrains_Mono',ui-monospace,monospace] text-[0.7rem] font-medium text-[#6A5B88]`
  const studioFilterOptions = useMemo(() => {
    const merged = [...DEFAULT_STUDIO_OPTIONS]
    if (Array.isArray(movies)) {
      for (const m of movies) {
        const s = normalizeStudio(m.studio?.trim())
        if (s && !merged.includes(s)) merged.push(s)
      }
    }
    // Keep 'Independent' always last; sort the rest alphabetically
    const withoutInd = merged.filter(s => s !== 'Independent').sort((a, b) => a.localeCompare(b))
    return [...withoutInd, 'Independent']
  }, [movies])

  // Close admin menu on outside click; re-lock catalog import gate when menu closes
  useEffect(() => {
    if (!adminMenuOpen) {
      setCatalogImportGate('locked')
      setCatalogImportPwInput('')
      setCatalogImportPwError('')
      return
    }
    function handler(e) {
      if (adminMenuRef.current && !adminMenuRef.current.contains(e.target)) setAdminMenuOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [adminMenuOpen])

  const isSearching = searchTerm.trim() !== ''

  // Returns 'overspend' | 'underspend' | 'approved' | null based on live financial data
  const getFilmPerfStatus = useCallback((m) => {
    const budget = Number(movieBudgetTotals[m.film_number] ?? 0)
    const spent  = Number(movieMarketingTotals[m.film_number] ?? 0)
    if (budget <= 0 || spent <= 0) return null
    if (spent > budget)            return 'overspend'
    if (spent <= budget * 0.95)    return 'underspend'
    return 'approved'
  }, [movieBudgetTotals, movieMarketingTotals])

  const filteredMovies = useMemo(() => {
    const all = Array.isArray(movies) ? movies : []

    let base
    if (isSearching) {
      base = [...searchResults]
    } else if (hideNoData) {
      // ── "Active Only" mode: 7 most-recently-released + 5 soonest-upcoming ──
      const now = new Date(); now.setHours(0, 0, 0, 0)

      const released = all
        .filter(m => m.release_date && new Date(m.release_date) < now)
        .sort((a, b) => new Date(b.release_date) - new Date(a.release_date)) // most recent first

      const upcoming = all
        .filter(m => m.release_date && new Date(m.release_date) >= now)
        .sort((a, b) => new Date(a.release_date) - new Date(b.release_date)) // closest first

      // Fill up to 12 if one group is short
      const TARGET = 12, RELEASED_WANT = 7, UPCOMING_WANT = 5
      let relCount = Math.min(released.length, RELEASED_WANT)
      let upCount  = Math.min(upcoming.length, UPCOMING_WANT)
      const leftover = TARGET - relCount - upCount
      if (leftover > 0) {
        if (released.length > relCount) relCount = Math.min(released.length, relCount + leftover)
        else if (upcoming.length > upCount) upCount = Math.min(upcoming.length, upCount + leftover)
      }

      // Released descending, then upcoming ascending
      base = [...released.slice(0, relCount), ...upcoming.slice(0, upCount)]
    } else {
      base = [...all]
    }

    if (studioFilter !== '') {
      base = base.filter((m) => studioMatches(m.studio, studioFilter))
    }

    if (statusFilter !== '') {
      if (['approved', 'overspend', 'underspend'].includes(statusFilter)) {
        base = base.filter((m) => getFilmPerfStatus(m) === statusFilter)
      } else {
        base = base.filter((m) => (m.budget_status || 'plan_pre') === statusFilter)
      }
    }

    if (!isSearching && progressSort !== 'none') {
      const ratioFor = (movie) => {
        const budget = Number(movieBudgetTotals[movie.film_number] ?? 0)
        const spent  = Number(movieActualTotals[movie.film_number] ?? 0)
        if (budget <= 0) return spent > 0 ? 1 : 0
        return spent / budget
      }
      base.sort((a, b) => {
        const ra = ratioFor(a), rb = ratioFor(b)
        return progressSort === 'desc' ? rb - ra : ra - rb
      })
    }

    return base
  }, [
    movies, searchResults, isSearching, studioFilter, statusFilter, progressSort,
    hideNoData, movieBudgetTotals, movieActualTotals, movieIncomeTotals,
    getFilmPerfStatus,
  ])

  const studioOptions = useMemo(() => [...DEFAULT_STUDIO_OPTIONS], [])

  useEffect(() => {
    if (!addMovieOpen) return
    function onKey(e) {
      if (e.key === 'Escape') setAddMovieOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [addMovieOpen])

  function closeAddMovieModal() {
    if (addMovieBusy) return
    setAddMovieOpen(false)
    setAddMovieError(null)
  }

  async function handleAddMovieSubmit(e) {
    e.preventDefault()
    setAddMovieError(null)
    const he   = newMovieHebrew.trim()
    const en   = newMovieEnglish.trim()
    const code = newMovieCode.trim()
    if (!he && !en) {
      setAddMovieError('Enter at least a Hebrew or English title.')
      return
    }
    if (!code) {
      setAddMovieError('Film number is required.')
      return
    }
    const studio = newMovieStudio?.trim()
    if (!studio) {
      setAddMovieError('Choose a studio.')
      return
    }
    const profitCenter = newMovieProfitCenter.trim() || null
    setAddMovieBusy(true)
    try {
      // ── Duplicate checks before inserting ──────────────────────────────────
      const orFilters = [`film_number.eq.${code}`]
      if (profitCenter) orFilters.push(`profit_center.eq.${profitCenter}`)
      if (en) orFilters.push(`title_en.ilike.${en}`)
      if (he) orFilters.push(`title_he.ilike.${he}`)

      const { data: existing } = await supabase
        .from('films')
        .select('film_number, title_en, title_he, profit_center')
        .or(orFilters.join(','))
        .limit(5)

      if (existing && existing.length > 0) {
        const conflicts = existing.map(f => {
          const parts = []
          if (f.film_number === code)
            parts.push(`Film number "${code}" is already used by "${f.title_en || f.title_he || f.film_number}"`)
          if (profitCenter && f.profit_center === profitCenter)
            parts.push(`Profit center "${profitCenter}" is already assigned to "${f.title_en || f.title_he || f.film_number}"`)
          if (en && f.title_en?.toLowerCase() === en.toLowerCase())
            parts.push(`English title "${en}" already exists`)
          if (he && f.title_he?.toLowerCase() === he.toLowerCase())
            parts.push(`Hebrew title "${he}" already exists`)
          return parts
        }).flat().filter(Boolean)

        if (conflicts.length > 0) {
          setAddMovieError(conflicts.join('\n'))
          setAddMovieBusy(false)
          return
        }
      }

      const payload = {
        film_number:   code,
        title_en:      en || null,
        title_he:      he || null,
        studio,
        profit_center:   profitCenter,
        profit_center_2: newMovieProfitCenter2.trim() || null,
        release_date:    newMovieReleaseDate || null,
      }
      const { data, error } = await supabase.from('films').insert(payload).select().single()
      if (error) throw error
      await refreshMovies()
      setAddMovieOpen(false)
      setNewMovieHebrew('')
      setNewMovieEnglish('')
      setNewMovieCode('')
      setNewMovieProfitCenter('')
      setNewMovieProfitCenter2('')
      setNewMovieStudio(DEFAULT_STUDIO_OPTIONS[0])
      setNewMovieReleaseDate('')
    } catch (err) {
      setAddMovieError(err instanceof Error ? err.message : String(err))
    } finally {
      setAddMovieBusy(false)
    }
  }

  // ── auth gates ────────────────────────────────────────────────────────────
  if (session === undefined) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-gradient-to-br from-[#F4EFFF] via-[#FFF8F0] to-[#EFF9F6]">
        <Loader2 className="h-8 w-8 animate-spin text-[#4B4594]" />
      </div>
    )
  }
  if (!session) return <LoginPage />

  return (
    <div className="min-h-dvh w-full">

      <main className="w-full overflow-x-hidden pb-[env(safe-area-inset-bottom)]">

        <div className="mx-auto w-full max-w-7xl px-[clamp(1rem,3.5vw,2.5rem)] pb-20 pt-[clamp(2.25rem,7vh,5rem)]">
            <header className="mb-6 border-b border-[rgba(123,82,171,0.22)] pb-6">
              {/* Three-zone navbar: Logo | Actions | User */}
              <div className="flex items-center gap-4">

                {/* ── Left: Logo + tagline ── */}
                <div className="flex shrink-0 items-center gap-3">
                  <img src={tulipLogo} alt="Tulip logo" className="h-10 w-10 shrink-0 rounded-md object-contain" />
                  <div>
                    <p className="flex items-baseline gap-2">
                      <span className="font-['Montserrat',sans-serif] text-xl font-extrabold tracking-[0.06em] text-[#4B4594]">TULIP</span>
                      <span className="font-['Montserrat',sans-serif] text-xl font-bold uppercase tracking-[0.08em] text-[#F9B233]">Flow</span>
                    </p>
                    {/* Tagline — "movie" emphasised, "ing in sync" lighter */}
                    <p className="mt-1 font-['Georgia',serif] text-[0.7rem] italic tracking-[0.16em] text-[#7B52AB]/65">
                      <span className="font-extrabold not-italic text-[#7B52AB]">movie</span>ing in sync
                    </p>
                  </div>
                </div>

                {/* ── Centre: Primary action buttons (flex-1 centres them) ── */}
                <div className="flex flex-1 flex-wrap items-center justify-center gap-2">
                  {/* Add Movie */}
                  <button
                    type="button"
                    onClick={() => { setAddMovieError(null); setAddMovieOpen(true) }}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-[rgba(74,20,140,0.28)] bg-[#4B4594] px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-white shadow-[0_8px_18px_rgba(75,69,148,0.35)] transition hover:bg-[#5a529f]"
                  >
                    <Plus className="h-3.5 w-3.5" aria-hidden /> Add New Movie
                  </button>

                  {/* Upload Budget */}
                  <ExcelUploadButton
                    initialType="budgets"
                    lockType={true}
                    label="Upload Budget"
                    onUploadSuccess={() => { setBudgetRefresh(n => n + 1); void refreshMovies() }}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-[#2FA36B] px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-white shadow-[0_8px_18px_rgba(47,163,107,0.35)] transition hover:bg-[#28915f]"
                  />

                  {/* Upload Monthly Expenses/Rentals */}
                  <ExcelUploadButton
                    initialType="journal"
                    lockType={true}
                    label="Upload Monthly Expenses/Rentals"
                    onUploadSuccess={() => { setBudgetRefresh(n => n + 1); void refreshMovies() }}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-[#4B4594] px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-white shadow-[0_8px_18px_rgba(75,69,148,0.35)] transition hover:bg-[#5a529f]"
                  />

                  {/* Admin dropdown */}
                  <div className="relative" ref={adminMenuRef}>
                    <button
                      type="button"
                      onClick={() => setAdminMenuOpen(v => !v)}
                      className="inline-flex items-center gap-1.5 rounded-xl border border-[rgba(74,20,140,0.2)] bg-white px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-[#4A148C] transition hover:bg-[#F7F2FF]"
                    >
                      <Settings className="h-3.5 w-3.5" aria-hidden /> Admin <ChevronDown className="h-3 w-3" />
                    </button>
                    {adminMenuOpen && (() => {
                      const ALLOWED = ['eyalbar@tulipcp.com', 'yifatti@gmail.com']
                      const userEmail = session?.user?.email ?? ''
                      const isAllowed = ALLOWED.includes(userEmail.toLowerCase())

                      return (
                        <div className="absolute right-0 top-full z-50 mt-1.5 w-[260px] overflow-hidden rounded-xl border border-[rgba(74,20,140,0.15)] bg-white shadow-[0_16px_40px_rgba(74,20,140,0.18)]">
                          <p className="px-3.5 pt-3 pb-1 text-[0.55rem] font-semibold uppercase tracking-[0.2em] text-[#8A7BAB]">Catalog Imports</p>

                          {/* ── Access-denied state ── */}
                          {!isAllowed && (
                            <div className="mx-2 mb-3 rounded-lg bg-[#FFF1F3] px-3 py-3 text-center ring-1 ring-[#F43F5E]/20">
                              <div className="mb-1 text-lg">🔒</div>
                              <p className="text-[11px] font-bold text-[#C0004C]">Access Denied</p>
                              <p className="mt-0.5 text-[10px] text-[#9B2C2C]">Authorized Personnel Only</p>
                            </div>
                          )}

                          {/* ── Password challenge ── */}
                          {isAllowed && catalogImportGate === 'locked' && (
                            <div className="mx-2 mb-3 rounded-lg bg-[#F7F4FB] px-3 py-3 ring-1 ring-[rgba(74,20,140,0.12)]">
                              <p className="mb-2 text-[11px] font-semibold text-[#4B4594]">Confirm your password to continue</p>
                              <input
                                type="password"
                                value={catalogImportPwInput}
                                onChange={e => { setCatalogImportPwInput(e.target.value); setCatalogImportPwError('') }}
                                onKeyDown={async e => {
                                  if (e.key !== 'Enter') return
                                  const { error } = await supabase.auth.signInWithPassword({ email: userEmail, password: catalogImportPwInput })
                                  if (error) { setCatalogImportPwError('Incorrect password.') }
                                  else { setCatalogImportGate('unlocked'); setCatalogImportPwInput('') }
                                }}
                                placeholder="Password…"
                                className="mb-1.5 w-full rounded-lg border border-[rgba(74,20,140,0.2)] bg-white px-2.5 py-1.5 text-xs text-[#4B4594] outline-none focus:border-[#4B4594] focus:ring-1 focus:ring-[#4B4594]/20"
                                autoFocus
                              />
                              {catalogImportPwError && <p className="mb-1.5 text-[10px] text-[#C0004C]">{catalogImportPwError}</p>}
                              <button
                                type="button"
                                onClick={async () => {
                                  const { error } = await supabase.auth.signInWithPassword({ email: userEmail, password: catalogImportPwInput })
                                  if (error) { setCatalogImportPwError('Incorrect password.') }
                                  else { setCatalogImportGate('unlocked'); setCatalogImportPwInput('') }
                                }}
                                className="w-full rounded-lg bg-[#4B4594] py-1.5 text-[11px] font-semibold text-white transition hover:bg-[#3a3478]"
                              >Unlock</button>
                            </div>
                          )}

                          {/* ── Import tools (unlocked) ── */}
                          {isAllowed && catalogImportGate === 'unlocked' && (
                            <>
                              {[
                                { key: 'films',                label: 'Films list' },
                                { key: 'expenses',             label: 'Expenses catalog' },
                                { key: 'rentals',              label: 'Rentals catalog' },
                                { key: 'actual_expenses',      label: 'Monthly Expenses' },
                                { key: 'rental_transactions',  label: 'Monthly Income' },
                              ].map(({ key, label }) => (
                                <div key={key} className="px-2 py-0.5">
                                  <ExcelUploadButton
                                    initialType={key}
                                    label={label}
                                    onUploadSuccess={() => { setAdminMenuOpen(false); setCatalogImportGate('locked'); setBudgetRefresh(n => n + 1); void refreshMovies() }}
                                    className="w-full rounded-lg px-2.5 py-2 text-left text-[11px] font-medium text-[#5B4B7A] transition hover:bg-[#F7F2FF] flex items-center gap-2"
                                  />
                                </div>
                              ))}
                              <div className="px-2 pb-2 pt-1">
                                <button
                                  type="button"
                                  onClick={() => { setCatalogImportGate('locked'); setCatalogImportPwInput(''); setCatalogImportPwError('') }}
                                  className="w-full rounded-lg border border-[rgba(74,20,140,0.15)] py-1.5 text-[10px] font-semibold text-[#8A7BAB] transition hover:bg-[#F7F2FF]"
                                >🔒 Lock</button>
                              </div>
                            </>
                          )}
                        </div>
                      )
                    })()}
                  </div>
                </div>{/* end centre actions */}

                {/* ── Right: User email + Sign out ── */}
                <div className="flex shrink-0 items-center gap-2 text-[11px] text-[#8A7BAB]">
                  <span className="hidden max-w-[160px] truncate sm:block" title={session.user?.email}>
                    {session.user?.email}
                  </span>
                  <button
                    type="button"
                    onClick={() => supabase.auth.signOut()}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-[rgba(74,20,140,0.2)] bg-white px-2.5 py-1.5 text-[11px] font-semibold text-[#4A148C] transition hover:bg-[#F7F2FF]"
                    title="Sign out"
                  >
                    <LogOut className="h-3.5 w-3.5" aria-hidden />
                    Sign out
                  </button>
                </div>

              </div>{/* end three-zone navbar */}
            </header>

            {/* Monthly summary row */}
            {movies !== null && !loadError && <DashboardSummaryRow studioOptions={studioFilterOptions} />}

            {/* ── Dashboard Widgets ────────────────────────────────────────── */}
            {movies !== null && !loadError && (() => {
              const today = new Date(); today.setHours(0,0,0,0)
              const comingSoon = [...(movies ?? [])]
                .filter(m => {
                  if (!m.release_date) return false
                  const d = new Date(m.release_date); d.setHours(0,0,0,0)
                  return d >= today
                })
                .sort((a, b) => new Date(a.release_date) - new Date(b.release_date))
                .slice(0, 5)

              return (
                <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">

                  {/* ── Coming Soon ── */}
                  <div className="col-span-1 sm:col-span-2 rounded-2xl border border-[rgba(74,20,140,0.15)] bg-white p-5 shadow-sm">
                    <div className="mb-3 flex items-center gap-2">
                      <Calendar className="h-4 w-4 text-[#E65100]" aria-hidden />
                      <p className="text-[0.6rem] font-bold uppercase tracking-[0.2em] text-[#8A7BAB]">Coming Soon</p>
                    </div>
                    {comingSoon.length === 0 ? (
                      <p className="text-sm text-[#C0B8D8]">No upcoming releases found.</p>
                    ) : (
                      <ul className="space-y-1">
                        {comingSoon.map(m => {
                          const d = new Date(m.release_date)
                          const diff = Math.round((d - today) / 86400000)
                          const hasBudget = (movieBudgetTotals[m.film_number] ?? 0) > 0
                          const daysLabel = diff === 0 ? 'Today' : diff === 1 ? 'Tomorrow' : `in ${diff}d`
                          return (
                            <li key={m.film_number}>
                              <button
                                type="button"
                                onClick={() => setSelectedMovie(m)}
                                className="group grid w-full grid-cols-[1fr_auto] items-center gap-x-3 rounded-xl border border-transparent px-3 py-2 text-left transition hover:border-[rgba(74,20,140,0.12)] hover:bg-[#F7F4FB] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#4B4594]"
                              >
                                {/* Left: titles + budget status */}
                                <div className="min-w-0">
                                  <p className="truncate text-sm font-semibold text-[#2D1B69] group-hover:text-[#4B4594]">
                                    {m.title_en || m.title_he}
                                  </p>
                                  {m.title_he && m.title_en && (
                                    <p className="truncate text-[10px] text-[#9A8AB8]" dir="rtl" lang="he">{m.title_he}</p>
                                  )}
                                  {/* Always render budget status row for consistent height */}
                                  <div className="mt-0.5 flex h-4 items-center">
                                    {hasBudget ? (
                                      <span className="flex items-center gap-1 text-[10px] font-medium text-[#2FA36B]">
                                        <CheckCircle2 className="h-3 w-3 shrink-0" aria-hidden />
                                        Budget set
                                      </span>
                                    ) : (
                                      <span className="flex items-center gap-1 rounded-md bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-[#D97706] ring-1 ring-amber-200">
                                        <AlertCircle className="h-3 w-3 shrink-0" aria-hidden />
                                        Missing Budget
                                      </span>
                                    )}
                                  </div>
                                </div>

                                {/* Right: date + countdown */}
                                <div className="shrink-0 text-right">
                                  <p className="font-['Montserrat',sans-serif] text-xs font-bold text-[#E65100]">
                                    {formatReleaseDate(m.release_date)}
                                  </p>
                                  <p className="mt-0.5 text-[10px] text-[#9A8AB8]">{daysLabel}</p>
                                </div>
                              </button>
                            </li>
                          )
                        })}
                      </ul>
                    )}
                  </div>

                  {/* ── Last Update ── */}
                  <div className="rounded-2xl border border-[rgba(74,20,140,0.15)] bg-white p-5 shadow-sm">
                    <div className="mb-3 flex items-center gap-2">
                      <TrendingUp className="h-4 w-4 text-[#2FA36B]" aria-hidden />
                      <p className="text-[0.6rem] font-bold uppercase tracking-[0.2em] text-[#8A7BAB]">Last Update by Studio</p>
                    </div>
                    {lastUpdateInfo && lastUpdateInfo.length > 0 ? (
                      <div className="space-y-2">
                        {lastUpdateInfo.map(({ studio, period }) => (
                          <div key={studio} className="flex items-center justify-between gap-2 rounded-xl bg-[#F7F4FB] px-3 py-2">
                            <span className="rounded-md bg-[#EDE8F8] px-2 py-0.5 text-[10px] font-bold text-[#4A148C]">{studio}</span>
                            <span className="font-['Montserrat',sans-serif] text-sm font-extrabold text-[#2D1B69]">{period}</span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-[#C0B8D8]">No imports yet.</p>
                    )}
                  </div>

                  {/* ── Quick Actions ── */}
                  <div className="rounded-2xl border border-[rgba(74,20,140,0.15)] bg-white p-5 shadow-sm">
                    <div className="mb-3 flex items-center gap-2">
                      <Settings className="h-4 w-4 text-[#4B4594]" aria-hidden />
                      <p className="text-[0.6rem] font-bold uppercase tracking-[0.2em] text-[#8A7BAB]">Quick Actions</p>
                    </div>
                    <div className="flex flex-col gap-2">
                      <button type="button"
                        onClick={() => setFilmsManagerOpen(true)}
                        className="flex items-center gap-2.5 rounded-xl border border-[rgba(74,20,140,0.15)] bg-[#F7F4FB] px-3 py-2.5 text-left text-[12px] font-semibold text-[#4B4594] transition hover:bg-[#EDE8F8]">
                        <Clapperboard className="h-4 w-4 shrink-0 text-[#4B4594]" aria-hidden />
                        Manage Films
                      </button>
                      <button type="button"
                        onClick={() => setCatalogsManagerOpen('expenses')}
                        className="flex items-center gap-2.5 rounded-xl border border-[rgba(74,20,140,0.15)] bg-[#F7F4FB] px-3 py-2.5 text-left text-[12px] font-semibold text-[#4B4594] transition hover:bg-[#EDE8F8]">
                        <Receipt className="h-4 w-4 shrink-0 text-[#4B4594]" aria-hidden />
                        Manage Expenses
                      </button>
                      <button type="button"
                        onClick={() => setCatalogsManagerOpen('rentals')}
                        className="flex items-center gap-2.5 rounded-xl border border-[rgba(74,20,140,0.15)] bg-[#F7F4FB] px-3 py-2.5 text-left text-[12px] font-semibold text-[#4B4594] transition hover:bg-[#EDE8F8]">
                        <Film className="h-4 w-4 shrink-0 text-[#4B4594]" aria-hidden />
                        Manage Rentals
                      </button>
                      <button type="button"
                        onClick={() => setUploadsManagerOpen(true)}
                        className="flex items-center gap-2.5 rounded-xl border border-[rgba(74,20,140,0.15)] bg-[#F7F4FB] px-3 py-2.5 text-left text-[12px] font-semibold text-[#4B4594] transition hover:bg-[#EDE8F8]">
                        <History className="h-4 w-4 shrink-0 text-[#4B4594]" aria-hidden />
                        Manage Uploads
                      </button>
                    </div>
                  </div>

                </div>
              )
            })()}

          {movies === null && (
            <div className="flex items-center justify-center py-32">
              <div className="flex items-center gap-3 text-[#6A5B88]">
                <Loader2 className="h-5 w-5 animate-spin text-[#4B4594]" aria-hidden />
                <span className="text-sm font-medium">Loading…</span>
              </div>
            </div>
          )}

          {/* Error + get-started screen — always shows the Import button */}
          {movies !== null && loadError && (
            <div className="mx-auto max-w-lg rounded-2xl border border-[rgba(74,20,140,0.18)] bg-white p-8 text-center shadow-[0_24px_56px_rgba(74,20,140,0.14)]">
              <div className="mb-4 inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-red-50 ring-1 ring-red-200">
                <span className="text-2xl">⚠️</span>
              </div>
              <h2 className="mb-2 font-['Montserrat',sans-serif] text-lg font-bold text-[#4B4594]">
                Could not load films
              </h2>
              <p className="mb-1 text-sm text-[#6A5B88]">
                The <code className="rounded bg-[#F4F1FF] px-1.5 py-0.5 text-xs text-[#4A148C]">films</code> table
                returned an error. Make sure the table exists in Supabase.
              </p>
              <p className="mb-6 rounded-lg bg-red-50 px-3 py-2 text-left font-['JetBrains_Mono',ui-monospace,monospace] text-xs text-red-700 ring-1 ring-red-100">
                {loadError}
              </p>
              <p className="mb-4 text-sm font-medium text-[#5B4B7A]">
                If the table exists but is empty, use the Import button below to upload your film list from Excel.
              </p>
              <div className="flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
                <ExcelUploadButton
                  onUploadSuccess={() => {
                    setBudgetRefresh((n) => n + 1)
                    void refreshMovies()
                  }}
                />
                <button
                  type="button"
                  onClick={() => void refreshMovies()}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-[rgba(74,20,140,0.2)] bg-white px-3 py-1.5 text-xs font-semibold text-[#4A148C] transition hover:bg-[#F7F2FF]"
                >
                  Retry connection
                </button>
              </div>
            </div>
          )}

          {movies !== null && !loadError && (
            <>
              <section aria-label="Movies">
                <div className={`rounded-2xl ${brandBorder} bg-white/88 p-5 shadow-[0_24px_55px_rgba(74,20,140,0.12)] backdrop-blur-md`}
                >
                  {/* ── Toolbar: title + search + filters all in one bar ── */}
                  <div className="mb-5 flex flex-wrap items-center gap-3">
                    {/* Title + count */}
                    <div className="flex items-baseline gap-2 mr-auto">
                      <h2 className="text-[0.65rem] font-bold uppercase tracking-[0.22em] text-[#4A148C]">Active Films</h2>
                      <span className="rounded-full bg-[#EDE8F8] px-2 py-0.5 text-[10px] font-semibold text-[#4B4594]">{filteredMovies.length}</span>
                    </div>

                    {/* Search */}
                    <div className={`flex min-h-[2.25rem] w-56 items-center gap-2 rounded-xl ${brandBorder} bg-white/95 px-3 py-1.5 shadow-sm`}>
                      {searchLoading
                        ? <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-[#4A148C]" aria-hidden />
                        : <Search className="h-3.5 w-3.5 shrink-0 text-[#4A148C]" aria-hidden />}
                      <input
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        placeholder="Search…"
                        className="w-full min-w-0 bg-transparent text-xs text-[#5B4B7A] outline-none placeholder:text-[#9A8AB8]"
                      />
                      {searchTerm && (
                        <button type="button" onClick={() => setSearchTerm('')} className="shrink-0 text-[#9A8AB8] hover:text-[#4A148C]" aria-label="Clear">
                          <X className="h-3 w-3" />
                        </button>
                      )}
                    </div>

                    {/* Studio */}
                    <select
                      value={studioFilterOptions.includes(studioFilter) ? studioFilter : ''}
                      onChange={(e) => setStudioFilter(e.target.value)}
                      className={`rounded-xl ${brandBorder} bg-white/95 px-2.5 py-1.5 text-xs font-medium text-[#5B4B7A] shadow-sm outline-none transition focus:border-[#4B4594] focus:ring-2 focus:ring-[#4B4594]/20`}
                    >
                      <option value="">All Studios</option>
                      {studioFilterOptions.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
                    </select>

                    {/* Status pills */}
                    <div className="flex flex-wrap items-center gap-1">
                      {[
                        { key: '',               label: 'All',           activeBg: '#4B4594', activeText: '#fff', text: '#4B4594' },
                        { key: 'plan_pre',       label: 'Plan Pre',      activeBg: '#4B4594', activeText: '#fff', text: '#4B4594' },
                        { key: 'screening_post', label: 'Post',          activeBg: '#4B4594', activeText: '#fff', text: '#4B4594' },
                        { key: 'final',          label: 'Final',         activeBg: '#4B4594', activeText: '#fff', text: '#4B4594' },
                        { key: 'approved',       label: '✓ Approved',    activeBg: '#2FA36B', activeText: '#fff', text: '#2FA36B' },
                        { key: 'underspend',     label: '↓ Under',       activeBg: '#D97706', activeText: '#fff', text: '#D97706' },
                        { key: 'overspend',      label: '⚠ Over',        activeBg: '#C0004C', activeText: '#fff', text: '#C0004C' },
                      ].map(({ key, label, activeBg, activeText, text }) => {
                        const isActive = statusFilter === key
                        return (
                          <button key={key} type="button" onClick={() => setStatusFilter(key)}
                            style={isActive ? { background: activeBg, color: activeText } : { color: text }}
                            className={`rounded-lg px-2 py-0.5 text-[10px] font-semibold transition-all
                              ${isActive ? 'shadow-sm' : 'border border-[rgba(74,20,140,0.15)] bg-white/80 hover:bg-[#F7F2FF]'}`}
                          >{label}</button>
                        )
                      })}
                    </div>

                    {/* Sort + Active toggle */}
                    <button type="button"
                      onClick={() => setProgressSort(s => s === 'none' ? 'desc' : s === 'desc' ? 'asc' : 'none')}
                      className="inline-flex items-center gap-1 rounded-lg border border-[rgba(74,20,140,0.2)] bg-white/95 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-[#4A148C] transition hover:bg-[#F7F2FF]"
                    >
                      <ArrowUpDown className="h-3 w-3" aria-hidden />
                      {progressSort === 'none' ? 'Sort' : progressSort === 'desc' ? 'High%' : 'Low%'}
                    </button>
                    <button type="button"
                      onClick={() => setHideNoData(v => !v)}
                      className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.1em] transition ${hideNoData ? 'border-[#4B4594] bg-[#4B4594] text-white' : 'border-[rgba(74,20,140,0.2)] bg-white/95 text-[#4A148C] hover:bg-[#F7F2FF]'}`}
                    >
                      {hideNoData ? <Eye className="h-3 w-3" aria-hidden /> : <EyeOff className="h-3 w-3" aria-hidden />}
                      {hideNoData ? '7 + 5 Active' : 'All films'}
                    </button>
                  </div>

                  {filteredMovies.length === 0 ? (
                    <p className="py-6 text-center text-sm text-[#4A148C]">
                      {movies.length === 0
                        ? 'No movies yet. Use “Add new movie” to create a title.'
                        : 'No films match the current filters.'}
                    </p>
                  ) : (
                    <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                      {filteredMovies.map((m) => (
                        <li key={m.film_number}>
                          <SortableMovieCard
                            movie={m}
                            totalBudget={movieBudgetTotals[m.film_number] ?? 0}
                            actualSpent={movieMarketingTotals[m.film_number] ?? 0}
                            latestMonthLabel={movieLatestMonth[m.film_number]?.slice(0, 7) ?? null}
                            latestMonthExpenses={movieMonthlyExp[m.film_number] ?? 0}
                            latestMonthIncome={movieMonthlyInc[m.film_number] ?? 0}
                            isSelected={selectedMovie?.film_number === m.film_number}
                            onSelect={() => setSelectedMovie(selectedMovie?.film_number === m.film_number ? null : m)}
                          />
                        </li>
                      ))}
                    </ul>
                  )}

                </div>
              </section>
            </>
          )}

          {/* Credit — sits in the document flow, below the films grid */}
          <p className="mt-10 pb-4 text-center text-[11px] text-[#2D1B69]">
            Built with <span className="text-[#E61E6E]">❤️</span> by <span className="font-bold">Y.Tishler</span>
          </p>

        </div>
      </main>

      {/* ── Full-screen Budget Modal ──────────────────────────────────────── */}
      {selectedMovie && (() => {
        const film       = selectedMovie
        const filmBudget = movieBudgetTotals[film.film_number] ?? 0
        const filmIncome = movieIncomeTotals[film.film_number] ?? 0

        // Actual totals by media_budget_code (marketing only — no print)
        // filmSpent is derived from this so it always matches the budget table Grand Total
        const actualByCode = {}
        for (const r of (actualExpensesRows ?? []).filter(r => !isPrintCode(r.priority_code))) {
          const code = r.media_budget_code?.trim() || '__none__'
          actualByCode[code] = (actualByCode[code] ?? 0) + (Number(r.actual_amount) || 0)
        }

        // Total Spent = sum of all actuals that appear in the budget table (no orphans)
        // This ensures the KPI card always matches the Grand Total row in the table below
        const filmSpent   = Object.values(actualByCode).reduce((s, v) => s + v, 0)
        const filmBalance = filmBudget - filmSpent

        // Print expense rows from actuals
        const printRows = (actualExpensesRows ?? []).filter(r => isPrintCode(r.priority_code))
        const totalPrint = printRows.reduce((s, r) => s + (Number(r.actual_amount) || 0), 0)

        // In edit mode use draft rows; otherwise use the loaded rows
        const activeRows = budgetEditMode ? draftRows : (budgetRows ?? [])

        // ── Edit helpers ─────────────────────────────────────────────────────
        const updateDraft = (rowId, field, value) =>
          setDraftRows(prev => prev.map(r => r.id === rowId ? { ...r, [field]: value } : r))

        const addDraftRow = (mediaCode, isMediaHint = false, prefill = {}) => {
          setDraftRows(prev => [...prev, {
            id:           `new_${Date.now()}_${Math.random()}`,
            isNew:        true,
            categoryName: prefill.categoryName ?? '',
            vendorName:   prefill.vendorName   ?? '',
            budget:       prefill.budget       ?? 0,
            mediaCode:    mediaCode || '',
            isMedia:      isMediaHint,
          }])
          setExpandedGroups(prev => new Set([...prev, mediaCode || '__none__']))
        }

        const startEdit = () => {
          setDraftRows((budgetRows ?? []).map(r => ({ ...r })))
          setBudgetEditMode(true)
          // Expand all groups so user can see and edit everything
          setExpandedGroups(new Set((budgetRows ?? []).map(r => r.mediaCode || '__none__')))
        }

        const cancelEdit = () => {
          setBudgetEditMode(false)
          setDraftRows([])
        }

        // ── Budget Status helpers ─────────────────────────────────────────────
        // Only the 3 manual workflow stages — user clicks to advance
        const WORKFLOW_STAGES = [
          { key: 'plan_pre',       label: 'Plan Pre' },
          { key: 'screening_post', label: 'Screening Post' },
          { key: 'final',          label: 'Final' },
        ]

        // Auto-computed performance status — always derived from live financial data
        // 'approved'  → spending is healthy (>0 and ≤ budget, within 5%)
        // 'underspend'→ actual is more than 5% below planned
        // 'overspend' → actual exceeds planned
        const computePerfStatus = () => {
          if (filmBudget <= 0 || filmSpent <= 0) return null
          if (filmSpent > filmBudget)            return 'overspend'
          if (filmSpent <= filmBudget * 0.95)    return 'underspend'
          return 'approved'
        }

        const saveWorkflowStatus = async (newStatus) => {
          setBudgetStatusSaving(true)
          try {
            const { error } = await supabase
              .from('films')
              .update({ budget_status: newStatus })
              .eq('film_number', film.film_number)
            if (error) throw new Error(error.message)
            // Reflect immediately in the open modal without waiting for refresh
            setSelectedMovie(prev => ({ ...prev, budget_status: newStatus }))
            void refreshMovies()
          } catch (err) {
            console.error('Status save error:', err)
          } finally {
            setBudgetStatusSaving(false)
          }
        }

        const saveBudget = async () => {
          setBudgetSaving(true)
          try {
            const existing = draftRows.filter(r => !r.isNew && r.id)
            const newRows  = draftRows.filter(r => r.isNew)

            // Update existing rows one by one — avoids upsert ON CONFLICT issue
            // when the budgets table has no explicit unique constraint on id.
            for (const r of existing) {
              const { error } = await supabase
                .from('budgets')
                .update({
                  budget_item_name:  r.categoryName || '',
                  vendor_name:       r.vendorName   || null,
                  planned_amount:    Number(r.budget) || 0,
                  media_budget_code: r.mediaCode     || null,
                  is_media:          r.isMedia,
                })
                .eq('id', r.id)
              if (error) throw new Error(error.message)
            }

            if (newRows.length > 0) {
              const rowsToInsert = newRows
                .filter(r => r.categoryName?.trim())
                .map(r => ({
                  film_number:       film.film_number,
                  budget_item_name:  r.categoryName.trim(),
                  vendor_name:       r.vendorName   || null,
                  planned_amount:    Number(r.budget) || 0,
                  media_budget_code: r.mediaCode     || null,
                  is_media:          r.isMedia,
                }))
              if (rowsToInsert.length > 0) {
                const { error } = await supabase.from('budgets').insert(rowsToInsert)
                if (error) throw new Error(error.message)
              }
            }

            setBudgetSaveToast('success')
            setBudgetEditMode(false)
            setDraftRows([])
            setBudgetRefresh(n => n + 1)
            void refreshMovies()
            setTimeout(() => setBudgetSaveToast(null), 3500)
          } catch (err) {
            console.error('Budget save error:', err)
            setBudgetSaveToast('error')
          } finally {
            setBudgetSaving(false)
          }
        }

        // Group budget rows by media_budget_code (uses activeRows so edit mode works live)
        const groups = new Map()
        for (const row of activeRows) {
          const key = row.mediaCode || '__none__'
          if (!groups.has(key)) groups.set(key, { code: row.mediaCode, rows: [] })
          groups.get(key).rows.push(row)
        }

        const TH = ({ children, right }) => (
          <th className={`sticky top-0 z-10 border-b-2 border-[rgba(74,20,140,0.18)] bg-[#F7F2FF] px-4 py-3 text-[0.6rem] font-bold uppercase tracking-[0.14em] text-[#4A148C] ${right ? 'text-right' : 'text-left'}`}>
            {children}
          </th>
        )

        return (
          <div className="fixed inset-0 z-50 flex flex-col bg-[#F7F4FB]" role="dialog" aria-modal="true">

            {/* ── Sticky header bar ── */}
            <div className="flex shrink-0 items-center justify-between gap-4 border-b border-[rgba(74,20,140,0.14)] bg-white px-6 py-4 shadow-sm">
              <div className="flex min-w-0 items-center gap-3">
                {/* Back arrow */}
                <button
                  type="button"
                  onClick={() => setSelectedMovie(null)}
                  aria-label="Back to Dashboard"
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[#4A148C] transition hover:bg-[#EDE8F8] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#4B4594]"
                >
                  <ArrowLeft className="h-5 w-5" aria-hidden />
                </button>
                <div className="min-w-0">
                <p className="text-[0.6rem] font-semibold uppercase tracking-[0.2em] text-[#8A7BAB]">Budget Overview</p>
                <h1 className="truncate font-['Montserrat',sans-serif] text-xl font-extrabold text-[#4A148C]">
                  {movieTitleEnglish(film)}
                </h1>
                {movieTitleHebrewSubtitle(film) && (
                  <p className="text-sm text-[#9A8AB8]" lang="he">{movieTitleHebrewSubtitle(film)}</p>
                )}
                <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[#6A5B88]">
                  {movieStudioAndCodeLabel(film)}
                  {film.profit_center && <span className="font-['JetBrains_Mono',ui-monospace,monospace] text-[#7B52AB]">PC {film.profit_center}</span>}
                  {film.profit_center_2 && <span className="font-['JetBrains_Mono',ui-monospace,monospace] text-[#7B52AB]">PC2 {film.profit_center_2}</span>}
                  {formatReleaseDate(film.release_date) && (
                    <span className="inline-flex items-center gap-1 rounded-md bg-[#FFF3E0] px-1.5 py-0.5 text-[10px] font-semibold text-[#E65100]">
                      <Calendar className="h-2.5 w-2.5" aria-hidden />
                      {formatReleaseDate(film.release_date)}
                    </span>
                  )}
                </p>

                {/* ── Budget Status Widget ── */}
                {(() => {
                  const perfStatus   = computePerfStatus()
                  const manualStatus = film.budget_status || 'plan_pre'

                  return (
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      {/* 3 manual stage pills — always purple, no perf color override */}
                      <div className="flex items-center gap-0.5 rounded-xl bg-[#F0EBFF] p-0.5">
                        {WORKFLOW_STAGES.map(({ key, label }) => {
                          const isActive = manualStatus === key
                          return (
                            <button
                              key={key}
                              type="button"
                              disabled={budgetStatusSaving}
                              onClick={() => !budgetStatusSaving && saveWorkflowStatus(key)}
                              style={isActive ? { background: '#4B4594', color: '#fff' } : {}}
                              className={`rounded-lg px-2.5 py-1 text-[10px] font-semibold transition-all
                                ${isActive ? 'shadow-sm' : 'text-[#8A7BAB] hover:bg-white/60'}`}
                            >
                              {label}
                            </button>
                          )
                        })}
                      </div>

                      {/* Auto performance badge — computed from live data */}
                      {perfStatus === 'approved' && (
                        <span style={{ background: '#F0FBF5', color: '#2FA36B', borderColor: '#A7F3D0' }}
                          className="inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[10px] font-bold">
                          ✓ Approved
                        </span>
                      )}
                      {perfStatus === 'underspend' && (
                        <span style={{ background: '#FFFBEB', color: '#D97706', borderColor: '#FDE68A' }}
                          className="inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[10px] font-bold">
                          ↓ Underspend
                        </span>
                      )}
                      {perfStatus === 'overspend' && (
                        <span style={{ background: '#FFF1F3', color: '#C0004C', borderColor: '#FFBAC8' }}
                          className="inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[10px] font-bold">
                          ⚠ Overspend
                        </span>
                      )}
                      {budgetStatusSaving && (
                        <span className="text-[9px] italic text-[#8A7BAB]">Saving…</span>
                      )}
                    </div>
                  )
                })()}
                </div>{/* end inner title block */}
              </div>{/* end left flex group */}
              <div className="flex shrink-0 items-center gap-2">
                <ExcelUploadButton
                  initialType="budgets"
                  label="Upload Budget"
                  contextFilm={film}
                  onUploadSuccess={() => { setBudgetRefresh(n => n + 1); void refreshMovies() }}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-[#2FA36B] px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-[#28915f]"
                />
              </div>
            </div>

            {/* ── KPI strip ── */}
            <div className="shrink-0 border-b border-[rgba(74,20,140,0.1)] bg-white px-6 py-3">
              <div className="flex flex-wrap gap-3">
                {[
                  { label: 'Planned Budget', value: filmBudget,  color: '#4B4594' },
                  { label: 'Total Spent',    value: filmSpent,   color: '#C0392B' },
                  { label: 'Balance',        value: filmBalance, color: filmBalance >= 0 ? '#2FA36B' : '#E61E6E' },
                  { label: 'Total Revenue',  value: filmIncome,  color: '#0EA5A0' },
                  ...(totalPrint > 0 ? [{ label: 'Print Costs', value: totalPrint, color: '#7B52AB' }] : []),
                ].map(({ label, value, color }) => (
                  <div key={label} className="rounded-xl border border-[rgba(74,20,140,0.1)] bg-[#F7F2FF] px-4 py-2 text-center">
                    <p className="text-[0.55rem] font-semibold uppercase tracking-[0.14em] text-[#8A7BAB]">{label}</p>
                    <p className="mt-0.5 font-['Montserrat',sans-serif] text-sm font-extrabold tabular-nums" style={{ color }}>
                      {formatCurrency(value)}
                    </p>
                  </div>
                ))}
                {filmBalance < 0 && (
                  <div className="flex items-center rounded-xl bg-[#FFE5EC] px-4 py-2">
                    <span className="text-sm font-bold text-[#C0004C]">⚠ Over budget by {formatCurrency(Math.abs(filmBalance))}</span>
                  </div>
                )}
              </div>

              {/* ── Budget progress bar ── */}
              {filmBudget > 0 && (() => {
                const rawPct    = filmSpent / filmBudget          // may exceed 1
                const barPct    = Math.min(rawPct, 1)             // capped for the bar width
                const overBudget = filmSpent > filmBudget
                return (
                  <div className="mt-3">
                    <div className="mb-1 flex items-center justify-between text-[10px] font-semibold text-[#8A7BAB]">
                      <span>Budget used</span>
                      <span style={{ color: overBudget ? '#C0004C' : '#2FA36B' }}>
                        {(rawPct * 100).toFixed(1)}%
                        {overBudget && ' — Over budget'}
                      </span>
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-[#EDE8F8]">
                      <div
                        className="h-full rounded-full transition-all"
                        style={{
                          width: `${(barPct * 100).toFixed(1)}%`,
                          background: overBudget
                            ? 'linear-gradient(90deg,#E61E6E,#C0004C)'
                            : rawPct > 0.8
                            ? 'linear-gradient(90deg,#F59E0B,#D97706)'
                            : 'linear-gradient(90deg,#2FA36B,#0EA5A0)',
                        }}
                      />
                    </div>
                    <div className="mt-1 flex justify-between text-[9px] text-[#A09ABB]">
                      <span>{formatCurrency(filmSpent)} spent</span>
                      <span>{formatCurrency(filmBudget)} planned</span>
                    </div>
                  </div>
                )
              })()}
            </div>

            {/* ── Scrollable body ──
                IMPORTANT: no pt-* padding here. CSS sticky uses the content-box
                as its reference, so any padding-top creates a gap ABOVE the sticky
                header where scrolled-past rows remain visible. Use a child spacer
                instead so it scrolls away and the header truly pins to top:0.        */}
            <div className="flex-1 overflow-y-auto px-6 pb-20">
              {/* Spacer — scrolls away before the table header becomes sticky */}
              <div className="h-5" aria-hidden="true" />

              {budgetLoading && (
                <div className="flex items-center justify-center py-20">
                  <Loader2 className="h-8 w-8 animate-spin text-[#4B4594]" />
                </div>
              )}

              {budgetError && (
                <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{budgetError}</p>
              )}

              {!budgetLoading && !budgetError && budgetRows.length === 0 && (
                <p className="py-16 text-center text-sm text-[#8A7BAB]">
                  No budget uploaded yet for this film. Use <span className="font-semibold text-[#4B4594]">↑ Upload Budget</span> to import the budget file.
                </p>
              )}

              {/* ── Main budget table ── */}
              {!budgetLoading && !budgetError && (budgetRows.length > 0 || budgetEditMode) && (() => {
                const hasMediaFlag = activeRows.some(r => r.isMedia !== null && r.isMedia !== undefined)

                // Determine dominant media type for a group by majority vote
                const groupDominantMedia = (rows) => {
                  const mediaCount    = rows.filter(r => r.isMedia === true).length
                  const nonMediaCount = rows.filter(r => r.isMedia === false).length
                  const total         = mediaCount + nonMediaCount
                  if (total === 0)                    return null
                  if (mediaCount    / total > 0.5)   return true
                  if (nonMediaCount / total > 0.5)   return false
                  return null // exactly 50-50
                }

                // Split groups into media / non-media / unknown buckets using majority vote
                const mediaGroups    = [...groups.entries()].filter(([, { rows }]) => groupDominantMedia(rows) === true)
                const nonMediaGroups = [...groups.entries()].filter(([, { rows }]) => groupDominantMedia(rows) === false)
                const unknownGroups  = [...groups.entries()].filter(([, { rows }]) => groupDominantMedia(rows) === null)

                // Apply active filter
                const visibleGroups =
                  budgetFilter === 'media'    ? mediaGroups :
                  budgetFilter === 'nonmedia' ? nonMediaGroups :
                  /* all — media first, then non-media, then unknown */
                  [...mediaGroups, ...nonMediaGroups, ...unknownGroups]

                // Unmapped actuals: non-print expenses whose media_budget_code has no budget row
                const unmappedActuals = (actualExpensesRows ?? []).filter(r => {
                  if (isPrintCode(r.priority_code)) return false
                  const code = r.media_budget_code?.trim() || '__none__'
                  return !groups.has(code)
                })
                const unmappedTotal = unmappedActuals.reduce((s, r) => s + Number(r.actual_amount), 0)
                const showUnmapped  = unmappedTotal > 0 && budgetFilter === 'all'

                // Totals scoped to visible groups only (+ unmapped when showing all)
                const calcTotals = (entries) => {
                  const planned = entries.reduce((s, [, { rows }]) => s + rows.reduce((a, r) => a + r.budget, 0), 0)
                  const actual  = entries.reduce((s, [key]) => s + (actualByCode[key] ?? 0), 0)
                  return { planned, actual, variance: planned - actual }
                }

                const mediaTotals    = calcTotals(mediaGroups)
                const nonMediaTotals = calcTotals(nonMediaGroups)
                const baseVisibleTotals = calcTotals(visibleGroups)
                const visibleTotals  = {
                  planned:  baseVisibleTotals.planned,
                  actual:   baseVisibleTotals.actual  + (showUnmapped ? unmappedTotal : 0),
                  variance: baseVisibleTotals.variance - (showUnmapped ? unmappedTotal : 0),
                }

                const toggleGroup = (key) => setExpandedGroups(prev => {
                  const next = new Set(prev)
                  next.has(key) ? next.delete(key) : next.add(key)
                  return next
                })

                const editInput = (row, field, type = 'text') => (
                  <input
                    type={type}
                    value={type === 'number' ? (row[field] ?? 0) : (row[field] ?? '')}
                    onChange={e => updateDraft(row.id, field, type === 'number' ? Number(e.target.value) : e.target.value)}
                    className="w-full rounded-md border border-[rgba(74,20,140,0.25)] bg-white px-2 py-1 text-[12.5px] text-[#2D1B69] outline-none focus:border-[#4B4594] focus:ring-1 focus:ring-[#4B4594]/30"
                    placeholder={field === 'categoryName' ? 'Item name…' : field === 'vendorName' ? 'Vendor…' : '0'}
                  />
                )

                const mediaToggle = (row) => (
                  <button
                    type="button"
                    title={row.isMedia === true ? 'Media' : row.isMedia === false ? 'Non-Media' : 'Unknown'}
                    onClick={() => {
                      updateDraft(row.id, 'isMedia', row.isMedia !== true)
                    }}
                    className={`ml-1 rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide transition ${
                      row.isMedia === true  ? 'bg-[#BFDBFE] text-[#1D4ED8]' :
                      row.isMedia === false ? 'bg-[#FDE68A] text-[#92400E]' :
                      'bg-slate-100 text-[#8A7BAB]'
                    }`}
                  >
                    {row.isMedia === true ? 'M' : row.isMedia === false ? 'NM' : '?'}
                  </button>
                )

                const renderGroup = ([groupKey, { code, rows }]) => {
                  const groupBudget   = rows.reduce((s, r) => s + (Number(r.budget) || 0), 0)
                  const groupActual   = actualByCode[groupKey] ?? 0
                  const groupVariance = groupBudget - groupActual
                  const isExpanded    = expandedGroups.has(groupKey)
                  const dominantMedia = groupDominantMedia(rows)
                  const parentBg = dominantMedia === true ? 'bg-[#EFF6FF]' : dominantMedia === false ? 'bg-[#FFFBEB]' : 'bg-slate-50'
                  const childBg  = dominantMedia === true ? 'bg-white hover:bg-[#F0F8FF]' : dominantMedia === false ? 'bg-white hover:bg-[#FFFDF0]' : 'bg-white hover:bg-slate-50'

                  return (
                    <React.Fragment key={groupKey}>
                      {/* Parent summary row */}
                      <tr className={`border-t-2 border-[rgba(74,20,140,0.14)] ${parentBg} select-none ${budgetEditMode ? '' : 'cursor-pointer'}`}
                          onClick={budgetEditMode ? undefined : () => toggleGroup(groupKey)}>
                        <td className="px-4 py-3 font-bold text-[#2D1B69]">
                          {!budgetEditMode && <span className="mr-2 text-[10px] text-[#7B52AB]">{isExpanded ? '▾' : '▸'}</span>}
                          {budgetEditMode && <span className="mr-2 cursor-pointer text-[10px] text-[#7B52AB]" onClick={() => toggleGroup(groupKey)}>{isExpanded ? '▾' : '▸'}</span>}
                          {code || 'No Code'}
                          <span className="ml-2 text-[10px] font-normal text-[#9A8AB8]">({rows.length})</span>
                        </td>
                        <td className="px-4 py-3 text-xs font-medium text-[#8A7BAB]">—</td>
                        <td className="px-4 py-3 text-right font-['Montserrat',sans-serif] font-bold tabular-nums text-[#2D1B69]">{formatCurrency(groupBudget)}</td>
                        <td className="px-4 py-3 text-right font-['Montserrat',sans-serif] font-bold tabular-nums" style={{ color: groupActual > 0 ? '#B91C1C' : '#C4B8D8' }}>
                          {groupActual > 0 ? formatCurrency(groupActual) : '—'}
                        </td>
                        <td className={`px-4 py-3 text-right font-['Montserrat',sans-serif] font-bold tabular-nums ${varianceCellClass(groupVariance)}`}>
                          {formatCurrency(groupVariance)}
                        </td>
                      </tr>

                      {/* Child rows */}
                      {isExpanded && rows.map((row) => (
                        <tr key={row.id} className={`border-t border-[rgba(74,20,140,0.05)] ${childBg}`}>
                          <td className="py-2 pl-9 pr-4">
                            {budgetEditMode
                              ? <div className="flex items-center gap-1">{editInput(row, 'categoryName')}{mediaToggle(row)}</div>
                              : <span className="text-[12.5px] text-[#5B4B7A]">{row.categoryName}</span>
                            }
                          </td>
                          <td className="px-4 py-2">
                            {budgetEditMode
                              ? editInput(row, 'vendorName')
                              : <span className="text-xs text-[#A09ABB]">{row.vendorName || '—'}</span>
                            }
                          </td>
                          <td className="px-4 py-2 text-right">
                            {budgetEditMode
                              ? <input
                                  type="number"
                                  min="0"
                                  step="100"
                                  value={row.budget ?? 0}
                                  onChange={e => updateDraft(row.id, 'budget', Number(e.target.value))}
                                  className="w-28 rounded-md border border-[rgba(74,20,140,0.25)] bg-white px-2 py-1 text-right text-[12.5px] text-[#2D1B69] outline-none focus:border-[#4B4594] focus:ring-1 focus:ring-[#4B4594]/30"
                                />
                              : <span className="font-['Montserrat',sans-serif] text-[12.5px] tabular-nums text-[#5B4B7A]">{formatCurrency(row.budget)}</span>
                            }
                          </td>
                          <td className="px-4 py-2 text-right text-xs text-[#D1C8E8]">—</td>
                          <td className="px-4 py-2 text-right text-xs text-[#D1C8E8]">—</td>
                        </tr>
                      ))}

                      {/* Add row button — only in edit mode */}
                      {budgetEditMode && isExpanded && (
                        <tr className={`border-t border-dashed border-[rgba(74,20,140,0.1)] ${childBg}`}>
                          <td colSpan={5} className="px-4 py-1.5">
                            <button
                              type="button"
                              onClick={() => addDraftRow(code)}
                              className="flex items-center gap-1.5 rounded-lg px-3 py-1 text-[11px] font-semibold text-[#4B4594] transition hover:bg-[#EDE8F8]"
                            >
                              <span className="text-base leading-none">+</span> Add Budget Line
                            </button>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  )
                }

                const SectionDivider = ({ label, color, bg }) => (
                  <tr>
                    <td colSpan={5} className={`px-4 py-1.5 text-[0.6rem] font-bold uppercase tracking-[0.18em]`} style={{ background: bg, color }}>
                      {label}
                    </td>
                  </tr>
                )

                // ── Excel export ─────────────────────────────────────────────────────
                const exportToExcel = () => {
                  const filmTitle = movieTitleEnglish(film) || `film_${film.film_number}`
                  const rows = []

                  const addSection = (label, groups) => {
                    if (groups.length === 0) return
                    rows.push({ Category: label, 'Item Name': '', Vendor: '', 'Planned (₪)': '', 'Actual (₪)': '', 'Variance (₪)': '' })
                    for (const [groupKey, { code, rows: budgetRows }] of groups) {
                      const groupBudget  = budgetRows.reduce((s, r) => s + (Number(r.budget) || 0), 0)
                      const groupActual  = actualByCode[groupKey] ?? 0
                      const groupVar     = groupBudget - groupActual
                      // Summary row for the group
                      rows.push({
                        Category:       '',
                        'Item Name':    code || 'No Code',
                        Vendor:         '',
                        'Planned (₪)':  groupBudget,
                        'Actual (₪)':   groupActual || '',
                        'Variance (₪)': groupVar,
                      })
                      // Child rows
                      for (const r of budgetRows) {
                        rows.push({
                          Category:       '',
                          'Item Name':    `  ${r.categoryName}`,
                          Vendor:         r.vendorName || '',
                          'Planned (₪)':  r.budget,
                          'Actual (₪)':   '',
                          'Variance (₪)': '',
                        })
                      }
                    }
                  }

                  if (budgetFilter === 'all' && hasMediaFlag) {
                    addSection('Media Spend', mediaGroups)
                    addSection('Non-Media Spend', nonMediaGroups)
                  } else {
                    addSection('Budget', visibleGroups)
                  }

                  // Unrecognized section
                  if (showUnmapped && unmappedActuals.length > 0) {
                    rows.push({ Category: '⚠ Unrecognized Expenses', 'Item Name': '', Vendor: '', 'Planned (₪)': '', 'Actual (₪)': '', 'Variance (₪)': '' })
                    for (const r of unmappedActuals) {
                      rows.push({
                        Category:       '',
                        'Item Name':    r.expense_description || r.media_budget_code || '—',
                        Vendor:         '',
                        'Planned (₪)':  '',
                        'Actual (₪)':   Number(r.actual_amount),
                        'Variance (₪)': '',
                      })
                    }
                  }

                  // Grand total row
                  rows.push({
                    Category:       '',
                    'Item Name':    'GRAND TOTAL',
                    Vendor:         '',
                    'Planned (₪)':  visibleTotals.planned,
                    'Actual (₪)':   visibleTotals.actual,
                    'Variance (₪)': visibleTotals.variance,
                  })

                  const ws = XLSX.utils.json_to_sheet(rows)

                  // Column widths
                  ws['!cols'] = [
                    { wch: 22 },  // Category
                    { wch: 36 },  // Item Name
                    { wch: 22 },  // Vendor
                    { wch: 16 },  // Planned
                    { wch: 16 },  // Actual
                    { wch: 16 },  // Variance
                  ]

                  const wb = XLSX.utils.book_new()
                  XLSX.utils.book_append_sheet(wb, ws, 'Budget')
                  XLSX.writeFile(wb, `${filmTitle}_budget.xlsx`)
                }

                return (
                  <>
                  {/* ── Save toast ── */}
                  {budgetSaveToast && (
                    <div className={`mb-3 flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold shadow-sm ${
                      budgetSaveToast === 'success'
                        ? 'border border-[rgba(47,163,107,0.3)] bg-[#F0FBF5] text-[#1a7a4e]'
                        : 'border border-red-200 bg-red-50 text-red-700'
                    }`}>
                      {budgetSaveToast === 'success' ? '✓ Budget saved successfully.' : '✗ Save failed — please try again.'}
                    </div>
                  )}

                  {/* ── Filter tabs + Edit button bar ── */}
                  <div className="mb-4 flex shrink-0 items-center justify-between gap-4 flex-wrap">
                    {/* Filter pills — hidden in edit mode */}
                    {!budgetEditMode && (
                      <div className="flex items-center gap-1.5 rounded-xl border border-[rgba(74,20,140,0.12)] bg-white p-1 shadow-sm">
                        {[
                          { id: 'all',      label: 'All' },
                          { id: 'media',    label: 'Media Only',     activeBg: 'bg-[#BFDBFE]', activeText: 'text-[#1D4ED8]' },
                          { id: 'nonmedia', label: 'Non-Media Only', activeBg: 'bg-[#FDE68A]', activeText: 'text-[#92400E]' },
                        ].map(({ id, label }) => (
                          <button key={id} type="button" onClick={() => setBudgetFilter(id)}
                            className={`rounded-lg px-3 py-1.5 text-[11px] font-semibold transition-all ${
                              budgetFilter === id
                                ? id === 'media'    ? 'bg-[#BFDBFE] text-[#1D4ED8]'
                                : id === 'nonmedia' ? 'bg-[#FDE68A] text-[#92400E]'
                                : 'bg-[#2D1B69] text-white'
                                : 'text-[#8A7BAB] hover:bg-slate-50'
                            }`}>{label}</button>
                        ))}
                      </div>
                    )}

                    {budgetEditMode && (
                      <p className="flex items-center gap-1.5 rounded-xl border border-[rgba(74,20,140,0.2)] bg-[#F4F0FF] px-3 py-1.5 text-[11px] font-semibold text-[#4A148C]">
                        <Edit2 className="h-3 w-3" aria-hidden /> Editing mode — click any field to edit. M = Media · NM = Non-Media
                      </p>
                    )}

                    <div className="flex items-center gap-2">
                      {/* Legend */}
                      {hasMediaFlag && !budgetEditMode && (
                        <div className="flex items-center gap-3 text-[11px] font-medium text-[#6A5B88]">
                          <span className="flex items-center gap-1.5"><span className="inline-block h-3 w-5 rounded-sm bg-[#EFF6FF] border border-[#BFDBFE]" /> Media</span>
                          <span className="flex items-center gap-1.5"><span className="inline-block h-3 w-5 rounded-sm bg-[#FFFBEB] border border-[#FDE68A]" /> Non-media</span>
                          {showUnmapped && (
                            <span className="flex items-center gap-1.5"><span className="inline-block h-3 w-5 rounded-sm bg-[#FFF1F3] border border-[#FECDD3]" /> Unrecognized</span>
                          )}
                        </div>
                      )}

                      {/* Edit / Save / Cancel */}
                      {!budgetEditMode ? (
                        <div className="flex items-center gap-2">
                          <button type="button" onClick={exportToExcel}
                            className="flex items-center gap-1.5 rounded-xl border border-[rgba(74,20,140,0.2)] bg-white px-3 py-1.5 text-[11px] font-semibold text-[#2FA36B] transition hover:bg-[#F0FBF5]">
                            <Download className="h-3.5 w-3.5" aria-hidden /> Export
                          </button>
                          <button type="button" onClick={startEdit}
                            className="flex items-center gap-1.5 rounded-xl border border-[rgba(74,20,140,0.2)] bg-white px-3 py-1.5 text-[11px] font-semibold text-[#4A148C] transition hover:bg-[#F4F0FF]">
                            <Edit2 className="h-3.5 w-3.5" aria-hidden /> Edit Budget
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                          <button type="button" onClick={cancelEdit} disabled={budgetSaving}
                            className="rounded-xl border border-[rgba(74,20,140,0.2)] bg-white px-3 py-1.5 text-[11px] font-semibold text-[#8A7BAB] transition hover:bg-slate-50 disabled:opacity-50">
                            Cancel
                          </button>
                          <button type="button" onClick={saveBudget} disabled={budgetSaving}
                            className="flex items-center gap-1.5 rounded-xl bg-[#2FA36B] px-4 py-1.5 text-[11px] font-semibold text-white shadow-sm transition hover:bg-[#28915f] disabled:opacity-50">
                            {budgetSaving
                              ? <><Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> Saving…</>
                              : <><Save className="h-3.5 w-3.5" aria-hidden /> Save Changes</>
                            }
                          </button>
                        </div>
                      )}
                    </div>
                  </div>

                  {/*
                    Outer wrapper: overflow:clip clips painted content that scrolls past
                    the sticky header without breaking sticky positioning (unlike overflow:hidden).
                    The sticky <th> cells stick relative to the nearest scroll ancestor
                    (the .no-scrollbar flex-1 overflow-y-auto div above).
                  */}
                  <div style={{ borderRadius: '1rem', border: '1px solid rgba(74,20,140,0.18)', background: 'white', boxShadow: '0 4px 6px -1px rgba(0,0,0,.1),0 2px 4px -2px rgba(0,0,0,.1)', overflow: 'clip' }}>
                    <table className="w-full border-collapse text-sm">
                      <thead>
                        <tr>
                          {[['Name', false], ['Vendor', false], ['Planned (₪)', true], ['Actual (₪)', true], ['Variance', true]].map(([label, right], i) => (
                            <th
                              key={label}
                              style={{
                                position: 'sticky',
                                top: 0,
                                zIndex: 10,
                                backgroundColor: '#2D1B69',
                              }}
                              className={`px-4 py-3 text-[0.6rem] font-bold uppercase tracking-[0.15em] text-white/80 ${right ? 'text-right' : 'text-left'} ${i === 0 ? 'rounded-tl-2xl' : ''} ${i === 4 ? 'rounded-tr-2xl' : ''}`}
                            >
                              {label}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {budgetFilter === 'all' && hasMediaFlag ? (
                          <>
                            {mediaGroups.length > 0 && (
                              <><SectionDivider label="Media Spend" color="#1D4ED8" bg="#EFF6FF" />{mediaGroups.map(renderGroup)}</>
                            )}
                            {nonMediaGroups.length > 0 && (
                              <><SectionDivider label="Non-Media Spend" color="#92400E" bg="#FFFBEB" />{nonMediaGroups.map(renderGroup)}</>
                            )}
                            {unknownGroups.length > 0 && (
                              <><SectionDivider label="Other / Uncategorised" color="#6A5B88" bg="#F7F4FB" />{unknownGroups.map(renderGroup)}</>
                            )}
                          </>
                        ) : (
                          visibleGroups.map(renderGroup)
                        )}

                        {/* ── Unmapped / uncategorized actuals ── */}
                        {showUnmapped && (() => {
                          const isOpen = expandedGroups.has('__unmapped__')
                          return (
                            <>
                              <SectionDivider label="⚠ Unrecognized Expenses" color="#BE123C" bg="#FFF1F3" />
                              {/* Parent summary row */}
                              <tr
                                className="cursor-pointer border-b border-rose-200 bg-[#FFF1F3] hover:bg-rose-100/70"
                                onClick={() => toggleGroup('__unmapped__')}
                              >
                                <td className="px-4 py-3 text-sm font-bold text-rose-800">
                                  <span className="mr-2 text-[10px] text-rose-400">{isOpen ? '▾' : '▸'}</span>
                                  Unrecognized Expenses
                                </td>
                                <td className="px-4 py-3 text-right text-xs text-rose-400">—</td>
                                <td className="px-4 py-3 text-right text-xs text-rose-400">—</td>
                                <td className="px-4 py-3 text-right font-['Montserrat',sans-serif] text-sm font-bold tabular-nums text-rose-700">
                                  {formatCurrency(unmappedTotal)}
                                </td>
                                <td className="px-4 py-3 text-right font-['Montserrat',sans-serif] text-sm font-bold tabular-nums text-rose-600">
                                  {formatCurrency(-unmappedTotal)}
                                </td>
                              </tr>
                              {/* Individual unmapped rows */}
                              {isOpen && unmappedActuals.map((r, i) => (
                                <tr key={i} className="border-b border-rose-100 bg-[#FFF8F9]">
                                  <td className="py-2 pl-10 pr-4 text-[12px] text-rose-900" dir="auto">
                                    {r.expense_description || r.priority_code || '—'}
                                    {budgetEditMode && (
                                      <button
                                        type="button"
                                        title="Create a budget line for this expense"
                                        onClick={(e) => {
                                          e.stopPropagation()
                                          const code        = r.media_budget_code?.trim() || ''
                                          const isMediaHint = r.expense_type === 'מדיה'
                                          addDraftRow(code, isMediaHint, {
                                            categoryName: r.expense_description || r.priority_code || '',
                                            vendorName:   r.studio_name || '',
                                            budget:       Number(r.actual_amount) || 0,
                                          })
                                          setExpandedGroups(prev => new Set([...prev, code || '__none__']))
                                        }}
                                        className="ml-2 rounded bg-rose-200 px-1.5 py-0.5 text-[9px] font-bold text-rose-800 hover:bg-rose-300"
                                      >
                                        + Add to Budget
                                      </button>
                                    )}
                                  </td>
                                  <td className="px-4 py-2 text-right text-[11px] text-rose-500">
                                    {r.media_budget_code || <span className="italic text-rose-300">no code</span>}
                                  </td>
                                  <td className="px-4 py-2 text-right text-[11px] text-rose-500">
                                    {r.month_period ? r.month_period.slice(0, 7) : '—'}
                                  </td>
                                  <td className="px-4 py-2 text-right font-['Montserrat',sans-serif] text-[12px] tabular-nums text-rose-800">
                                    {formatCurrency(Number(r.actual_amount))}
                                  </td>
                                  <td className="px-4 py-2" />
                                </tr>
                              ))}
                            </>
                          )
                        })()}
                      </tbody>
                      <tfoot>
                        {/* Sub-totals row — only shown when filter is 'all' and both types exist */}
                        {budgetFilter === 'all' && mediaGroups.length > 0 && nonMediaGroups.length > 0 && (
                          <tr className="border-t border-[rgba(74,20,140,0.1)] bg-[#F7F4FB]">
                            <td colSpan={2} className="px-4 py-2 text-[11px] text-[#8A7BAB]">
                              <span className="mr-4">
                                <span className="inline-block h-2 w-3 rounded-sm bg-[#BFDBFE] mr-1" />
                                Media: <strong className="text-[#1D4ED8]">{formatCurrency(mediaTotals.planned)}</strong>
                              </span>
                              <span>
                                <span className="inline-block h-2 w-3 rounded-sm bg-[#FDE68A] mr-1" />
                                Non-media: <strong className="text-[#92400E]">{formatCurrency(nonMediaTotals.planned)}</strong>
                              </span>
                            </td>
                            <td className="px-4 py-2" />
                            <td className="px-4 py-2" />
                            <td className="px-4 py-2" />
                          </tr>
                        )}
                        {/* Grand total */}
                        <tr className="border-t-4 border-[#2D1B69] bg-[#2D1B69]">
                          <td colSpan={2} className="px-4 py-3.5 text-sm font-extrabold tracking-wide text-white">
                            {budgetFilter === 'media' ? 'Media Total' : budgetFilter === 'nonmedia' ? 'Non-Media Total' : 'Grand Total'}
                          </td>
                          <td className="px-4 py-3.5 text-right font-['Montserrat',sans-serif] text-sm font-extrabold tabular-nums text-white">
                            {formatCurrency(visibleTotals.planned)}
                          </td>
                          <td className="px-4 py-3.5 text-right font-['Montserrat',sans-serif] text-sm font-extrabold tabular-nums text-white/90">
                            {visibleTotals.actual > 0 ? formatCurrency(visibleTotals.actual) : '—'}
                          </td>
                          <td className="px-4 py-3.5 text-right font-['Montserrat',sans-serif] text-sm font-extrabold tabular-nums">
                            {visibleTotals.actual > 0
                              ? <span style={{ color: visibleTotals.variance >= 0 ? '#6EE7B7' : '#FCA5A5' }}>{formatCurrency(visibleTotals.variance)}</span>
                              : <span className="text-white/40">—</span>}
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                  </>
                )
              })()}

              {/* ── Print Expenses section ── */}
              {printRows.length > 0 && (
                <div className="mt-8">
                  <div className="mb-3 flex items-center gap-2">
                    <div className="h-2.5 w-2.5 rounded-full bg-[#7B52AB]" />
                    <h2 className="text-[0.65rem] font-bold uppercase tracking-[0.2em] text-[#7B52AB]">
                      Print &amp; Technical Expenses — {formatCurrency(totalPrint)} (excluded from budget)
                    </h2>
                  </div>
                  <div className="overflow-hidden rounded-2xl border border-[rgba(123,82,171,0.2)] bg-white shadow-sm">
                    <table className="w-full border-collapse text-sm">
                      <thead>
                        <tr>
                          {['Priority Code', 'Description', 'Month', 'Amount'].map((h, i) => (
                            <th key={h} className={`border-b-2 border-[rgba(123,82,171,0.18)] bg-[#F4F0FF] px-4 py-3 text-[0.6rem] font-bold uppercase tracking-[0.14em] text-[#7B52AB] ${i > 1 ? 'text-right' : 'text-left'}`}>
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {printRows.map((r, i) => (
                          <tr key={i} className="border-t border-[rgba(123,82,171,0.07)] hover:bg-[#FAF7FF]">
                            <td className="px-4 py-2.5 font-['JetBrains_Mono',ui-monospace,monospace] text-xs font-semibold text-[#7B52AB]">{r.priority_code}</td>
                            <td className="px-4 py-2.5 text-xs text-[#8A7BAB]">{r.expense_description || '—'}</td>
                            <td className="px-4 py-2.5 text-right font-['JetBrains_Mono',ui-monospace,monospace] text-xs tabular-nums text-[#8A7BAB]">{r.month_period?.slice(0,7) ?? '—'}</td>
                            <td className="px-4 py-2.5 text-right font-['Montserrat',sans-serif] text-sm font-semibold tabular-nums text-[#7B52AB]">{formatCurrency(r.actual_amount)}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr className="border-t-2 border-[rgba(123,82,171,0.2)] bg-[#F4F0FF]">
                          <td colSpan={3} className="px-4 py-2.5 text-xs font-bold text-[#7B52AB]">Total Print</td>
                          <td className="px-4 py-2.5 text-right font-['Montserrat',sans-serif] text-sm font-extrabold tabular-nums text-[#7B52AB]">
                            {formatCurrency(totalPrint)}
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </div>
              )}

              {/* ── Trend chart ── */}
              {(actualExpensesRows.length > 0 || incomeRows.length > 0) && (
                <div className="mt-8 pb-20">
                  <div className="mb-3 flex items-center gap-2">
                    <TrendingUp className="h-4 w-4 text-[#4B4594]" aria-hidden />
                    <p className="text-[0.6rem] font-semibold uppercase tracking-[0.2em] text-[#4A148C]">Accumulated Trend</p>
                  </div>
                  <div className="rounded-2xl border border-[rgba(74,20,140,0.12)] bg-white p-6">
                    <TrendChart filmNumber={film.film_number} />
                    <div className="mt-3 flex items-center justify-center gap-6">
                      <span className="flex items-center gap-1.5 text-[11px] text-[#8A7BAB]"><span className="inline-block h-2 w-5 rounded-full bg-[#C0392B]" /> Accum. Expenses</span>
                      <span className="flex items-center gap-1.5 text-[11px] text-[#8A7BAB]"><span className="inline-block h-2 w-5 rounded-full bg-[#0EA5A0]" /> Accum. Revenue</span>
                    </div>
                  </div>
                </div>
              )}

            </div>
          </div>
        )
      })()}

      {catalogsManagerOpen && (
        <CatalogsManagementModal
          defaultTab={catalogsManagerOpen}
          onClose={() => setCatalogsManagerOpen(null)}
        />
      )}

      {uploadsManagerOpen && (
        <UploadsManagementModal onClose={() => setUploadsManagerOpen(false)} />
      )}

      {filmsManagerOpen && (
        <FilmsManagementModal onClose={() => { setFilmsManagerOpen(false); void refreshMovies() }} />
      )}

      {addMovieOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          role="presentation"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) closeAddMovieModal()
          }}
        >
          <div className="absolute inset-0 bg-[#1a1030]/45 backdrop-blur-[2px]" aria-hidden />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="add-movie-title"
            className="relative z-10 flex max-h-[90vh] w-full max-w-md flex-col rounded-2xl border border-[rgba(74,20,140,0.2)] bg-white shadow-[0_28px_60px_rgba(74,20,140,0.22)]"
            onMouseDown={(e) => e.stopPropagation()}
          >
            {/* Fixed header */}
            <div className="shrink-0 border-b border-[rgba(74,20,140,0.1)] px-6 pb-4 pt-6">
            <div className="flex items-start justify-between gap-3">
              <h2
                id="add-movie-title"
                className="font-['Montserrat',sans-serif] text-lg font-bold text-[#4B4594]"
              >
                Add new movie
              </h2>
              <button
                type="button"
                onClick={closeAddMovieModal}
                disabled={addMovieBusy}
                className="rounded-lg p-1.5 text-[#8A7BAB] transition hover:bg-[#F7F2FF] hover:text-[#4A148C] disabled:opacity-50"
                aria-label="Close"
              >
                <X className="h-5 w-5" aria-hidden />
              </button>
            </div>
            </div>{/* end fixed header */}

            {/* Scrollable body */}
            <form onSubmit={handleAddMovieSubmit} className="overflow-y-auto px-6 py-5 space-y-3.5">

              {/* Hebrew title */}
              <div>
                <label htmlFor="movie-name-he" className="mb-0.5 block text-xs font-semibold uppercase tracking-[0.14em] text-[#4A148C]">
                  Movie name (Hebrew)
                </label>
                <p className="mb-1.5 text-left text-[10px] text-[#8A7BAB]" lang="he">שם הסרט בעברית</p>
                <input
                  id="movie-name-he"
                  type="text"
                  dir="rtl"
                  lang="he"
                  value={newMovieHebrew}
                  onChange={(e) => setNewMovieHebrew(e.target.value)}
                  autoComplete="off"
                  className="w-full rounded-xl border border-[rgba(74,20,140,0.2)] bg-white px-3 py-2.5 text-sm text-[#4A148C] outline-none transition focus:border-[#4B4594] focus:ring-2 focus:ring-[#4B4594]/25"
                  placeholder="שם הסרט"
                />
              </div>

              {/* English title */}
              <div>
                <label htmlFor="movie-name-en" className="mb-0.5 block text-xs font-semibold uppercase tracking-[0.14em] text-[#4A148C]">
                  Movie name (English)
                </label>
                <p className="mb-1.5 text-[10px] text-[#8A7BAB]">שם הסרט באנגלית</p>
                <input
                  id="movie-name-en"
                  type="text"
                  value={newMovieEnglish}
                  onChange={(e) => setNewMovieEnglish(e.target.value)}
                  autoComplete="off"
                  className="w-full rounded-xl border border-[rgba(74,20,140,0.2)] bg-white px-3 py-2.5 text-sm text-[#4A148C] outline-none transition focus:border-[#4B4594] focus:ring-2 focus:ring-[#4B4594]/25"
                  placeholder="Title in English"
                />
              </div>

              {/* Film number */}
              <div>
                <label htmlFor="movie-code" className="mb-0.5 block text-xs font-semibold uppercase tracking-[0.14em] text-[#4A148C]">
                  Film number
                </label>
                <p className="mb-1.5 text-[10px] text-[#8A7BAB]">קוד הסרט</p>
                <input
                  id="movie-code"
                  type="text"
                  value={newMovieCode}
                  onChange={(e) => setNewMovieCode(e.target.value)}
                  autoComplete="off"
                  className="w-full rounded-xl border border-[rgba(74,20,140,0.2)] bg-white px-3 py-2.5 font-['JetBrains_Mono',ui-monospace,monospace] text-sm text-[#4A148C] outline-none transition focus:border-[#4B4594] focus:ring-2 focus:ring-[#4B4594]/25"
                  placeholder="e.g. WB001"
                />
              </div>

              {/* Profit Center */}
              <div>
                <label htmlFor="movie-profit-center" className="mb-0.5 block text-xs font-semibold uppercase tracking-[0.14em] text-[#4A148C]">
                  Profit Center
                </label>
                <p className="mb-1.5 text-[10px] text-[#8A7BAB]">מרכז רווח</p>
                <input
                  id="movie-profit-center"
                  type="text"
                  value={newMovieProfitCenter}
                  onChange={(e) => setNewMovieProfitCenter(e.target.value)}
                  autoComplete="off"
                  className="w-full rounded-xl border border-[rgba(74,20,140,0.2)] bg-white px-3 py-2.5 font-['JetBrains_Mono',ui-monospace,monospace] text-sm text-[#4A148C] outline-none transition focus:border-[#4B4594] focus:ring-2 focus:ring-[#4B4594]/25"
                  placeholder="e.g. 30015"
                />
              </div>

              {/* Profit Center 2 */}
              <div>
                <label htmlFor="movie-profit-center-2" className="mb-0.5 block text-xs font-semibold uppercase tracking-[0.14em] text-[#4A148C]">
                  Profit Center 2 <span className="normal-case font-normal text-[#9A8AB8]">(optional)</span>
                </label>
                <p className="mb-1.5 text-[10px] text-[#8A7BAB]">מרכז רווח נוסף</p>
                <input
                  id="movie-profit-center-2"
                  type="text"
                  value={newMovieProfitCenter2}
                  onChange={(e) => setNewMovieProfitCenter2(e.target.value)}
                  autoComplete="off"
                  className="w-full rounded-xl border border-[rgba(74,20,140,0.2)] bg-white px-3 py-2.5 font-['JetBrains_Mono',ui-monospace,monospace] text-sm text-[#4A148C] outline-none transition focus:border-[#4B4594] focus:ring-2 focus:ring-[#4B4594]/25"
                  placeholder="e.g. 30016"
                />
              </div>

              {/* Studio */}
              <div>
                <label htmlFor="movie-studio" className="mb-0.5 block text-xs font-semibold uppercase tracking-[0.14em] text-[#4A148C]">
                  Studio
                </label>
                <p className="mb-1.5 text-[10px] text-[#8A7BAB]">שם האולפן המפיק</p>
                <select
                  id="movie-studio"
                  value={studioOptions.includes(newMovieStudio) ? newMovieStudio : studioOptions[0] ?? ''}
                  onChange={(e) => setNewMovieStudio(e.target.value)}
                  className="w-full rounded-xl border border-[rgba(74,20,140,0.2)] bg-white px-3 py-2.5 text-sm text-[#4A148C] outline-none transition focus:border-[#4B4594] focus:ring-2 focus:ring-[#4B4594]/25"
                >
                  {studioOptions.map((opt) => (
                    <option key={opt} value={opt}>{opt}</option>
                  ))}
                </select>
              </div>

              {/* Release Date */}
              <div>
                <label htmlFor="movie-release-date" className="mb-0.5 block text-xs font-semibold uppercase tracking-[0.14em] text-[#4A148C]">
                  Release Date
                </label>
                <p className="mb-1.5 text-[10px] text-[#8A7BAB]">תאריך יציאה לאקרנים</p>
                <input
                  id="movie-release-date"
                  type="date"
                  value={newMovieReleaseDate}
                  onChange={(e) => setNewMovieReleaseDate(e.target.value)}
                  className="w-full rounded-xl border border-[rgba(74,20,140,0.2)] bg-white px-3 py-2.5 text-sm text-[#4A148C] outline-none transition focus:border-[#4B4594] focus:ring-2 focus:ring-[#4B4594]/25"
                />
              </div>

              {addMovieError && (
                <p className="rounded-lg border border-red-500/35 bg-red-500/10 px-3 py-2 text-sm text-red-800" role="alert">
                  {addMovieError}
                </p>
              )}

              <div className="flex flex-wrap justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={closeAddMovieModal}
                  disabled={addMovieBusy}
                  className="rounded-xl border border-[rgba(74,20,140,0.2)] bg-white px-4 py-2.5 text-sm font-semibold text-[#4A148C] transition hover:bg-[#F7F2FF] disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={addMovieBusy}
                  className="rounded-xl bg-[#F9B233] px-4 py-2.5 text-sm font-semibold text-[#4B4594] shadow-[0_10px_22px_rgba(249,178,51,0.35)] transition hover:bg-[#fbc050] disabled:opacity-60"
                >
                  {addMovieBusy ? 'Saving…' : 'Save movie'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  )
}
