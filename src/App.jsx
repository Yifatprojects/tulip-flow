import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { DndContext, PointerSensor, closestCenter, useSensor, useSensors } from '@dnd-kit/core'
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  ArrowUpDown, BookOpen, Calendar, ChevronDown, Clapperboard,
  DollarSign, Eye, EyeOff, Film, Loader2, LogOut, Plus, Receipt,
  Search, Settings, TrendingUp, X,
} from 'lucide-react'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts'
import { supabase } from './lib/supabaseClient'
import tulipLogo from './assets/tulip-logo.png'
import { ExcelUploadButton } from './ExcelUpload'
import { FilmsManagementModal } from './FilmsManagement'
import { LoginPage } from './LoginPage'

/** @typedef {import('./types/movie').Movie} Movie */

/** Fixed studio name options for the add-movie form */
const DEFAULT_STUDIO_OPTIONS = ['Universal', 'Paramount', 'Other']

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
  const studio = movie.studio?.trim()
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
  if (value == null || value === '') return '—'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return String(value)
  return d.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
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
  const { data, error } = await supabase
    .from('budgets')
    .select('budget_item_name, planned_amount, media_budget_code')
    .eq('film_number', filmNumber)

  if (error) throw new Error(error.message)

  // Group by media_budget_code when present, otherwise by budget_item_name
  const byCat = new Map()
  for (const b of data ?? []) {
    const code = b.media_budget_code?.trim() || ''
    const name = b.budget_item_name?.trim() || 'Uncategorised'
    const key  = code || name
    const existing = byCat.get(key) ?? { categoryId: key, categoryName: name, mediaCode: code, budget: 0 }
    existing.budget += Number(b.planned_amount) || 0
    byCat.set(key, existing)
  }

  return [...byCat.values()]
    .sort((a, b) => (a.mediaCode || a.categoryName).localeCompare(b.mediaCode || b.categoryName))
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
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: movie.film_number,
  })
  const style = { transform: CSS.Transform.toString(transform), transition }

  const spentRatio   = totalBudget > 0 ? Math.min((actualSpent / totalBudget) * 100, 100) : actualSpent > 0 ? 100 : 0
  const isOverBudget = totalBudget > 0 && actualSpent > totalBudget
  const isAt90       = !isOverBudget && spentRatio >= 90
  const isAt80       = !isOverBudget && spentRatio >= 80 && spentRatio < 90

  return (
    <button
      ref={setNodeRef}
      style={style}
      type="button"
      onClick={onSelect}
      {...attributes}
      {...listeners}
      className={`group relative w-full rounded-xl border p-3.5 text-left transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[rgba(75,69,148,0.5)] ${
        isSelected
          ? 'border-[rgba(249,178,51,0.75)] bg-white shadow-[0_0_0_1px_rgba(249,178,51,0.45),0_12px_28px_rgba(249,178,51,0.24)]'
          : 'border-[rgba(123,82,171,0.24)] bg-white hover:border-[rgba(249,178,51,0.6)] hover:bg-[#FFFDF6] hover:shadow-[0_10px_22px_rgba(123,82,171,0.14)]'
      } ${isDragging ? 'opacity-60' : ''}`}
    >
      {/* Title row */}
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <h3 className="truncate font-['Montserrat',sans-serif] text-sm font-bold leading-tight text-[#F9B233]">
              {movieTitleEnglish(movie)}
            </h3>
            {isOverBudget && (
              <span className="shrink-0 rounded-full bg-[#FFE5EC] px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-[#E61E6E] ring-1 ring-[#E61E6E]/30">
                Over Budget
              </span>
            )}
          </div>
          {movieTitleHebrewSubtitle(movie) && (
            <p className="mt-0.5 truncate text-[10px] leading-snug text-[#9A8AB8]" dir="rtl" lang="he">
              {movieTitleHebrewSubtitle(movie)}
            </p>
          )}
          <p className="mt-0.5 truncate text-[10px] text-[#6A5B88]">{movieStudioAndCodeLabel(movie)}</p>
        </div>
        <div className="shrink-0 text-right">
          <p className="font-['Montserrat',sans-serif] text-sm font-bold tabular-nums text-[#4B4594]">
            {formatCurrency(totalBudget)}
          </p>
          <p className="text-[9px] text-[#8A7BAB]">Budget</p>
        </div>
      </div>

      {/* Progress bar */}
      <div className={`mb-1.5 h-2 w-full overflow-hidden rounded-full ${isOverBudget ? 'bg-[#FFE5EC]' : 'bg-[#F2E9FF]'}`}>
        <div
          className={`h-full rounded-full transition-all ${
            isOverBudget ? 'bg-gradient-to-r from-[#E61E6E] to-[#FF6B8A]'
              : isAt90    ? 'bg-[#C65A00]'
              : isAt80    ? 'bg-[#FF8A00]'
              : 'bg-gradient-to-r from-[#7B52AB] via-[#E61E6E] to-[#F9B233]'
          }`}
          style={{ width: `${spentRatio}%` }}
        />
      </div>

      {/* Spent / progress label */}
      <div className="mb-2 flex items-center justify-between text-[10px] text-[#8A7BAB]">
        <span>Spent <span className="font-semibold tabular-nums text-[#6A5B88]">{formatCurrency(actualSpent)}</span></span>
        <span className={`font-semibold tabular-nums ${isOverBudget ? 'text-[#E61E6E]' : isAt90 ? 'text-[#C65A00]' : 'text-[#8A7BAB]'}`}>
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
function DashboardSummaryRow() {
  const [summary, setSummary] = useState(null)

  useEffect(() => {
    const now = new Date()
    const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`
    const ytdStart = `${now.getFullYear()}-01-01`

    Promise.all([
      supabase.from('actual_expenses').select('actual_amount').eq('month_period', currentMonth),
      supabase.from('rental_transactions').select('actual_amount').eq('month_period', currentMonth),
      supabase.from('actual_expenses').select('actual_amount').gte('month_period', ytdStart).lte('month_period', currentMonth),
      supabase.from('rental_transactions').select('actual_amount').gte('month_period', ytdStart).lte('month_period', currentMonth),
    ]).then(([ce, ci, ye, yi]) => {
      const sum = (rows) => (rows.data ?? []).reduce((s, r) => s + Number(r.actual_amount), 0)
      setSummary({
        currExpenses: sum(ce), currIncome: sum(ci),
        ytdExpenses:  sum(ye), ytdIncome:  sum(yi),
      })
    })
  }, [])

  if (!summary) return null

  const cards = [
    { label: 'Current Month Revenue', value: summary.currIncome,   color: '#0EA5A0', icon: TrendingUp },
    { label: 'Current Month Expenses', value: summary.currExpenses, color: '#C0392B', icon: Receipt },
    { label: 'Revenue YTD',           value: summary.ytdIncome,    color: '#2FA36B', icon: DollarSign },
    { label: 'Expenses YTD',          value: summary.ytdExpenses,  color: '#7B52AB', icon: Film },
  ]

  return (
    <div className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
      {cards.map(({ label, value, color, icon: Icon }) => (
        <div key={label} className="rounded-xl border border-[rgba(74,20,140,0.12)] bg-white p-3.5 shadow-[0_6px_20px_rgba(74,20,140,0.07)]">
          <div className="mb-2 flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg" style={{ background: `${color}18` }}>
              <Icon className="h-3.5 w-3.5" style={{ color }} aria-hidden />
            </div>
            <p className="text-[0.6rem] font-semibold uppercase tracking-[0.16em] text-[#8A7BAB]">{label}</p>
          </div>
          <p className="font-['Montserrat',sans-serif] text-lg font-extrabold tabular-nums" style={{ color }}>
            {formatCurrency(value)}
          </p>
        </div>
      ))}
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
  const [progressSort, setProgressSort] = useState('none')
  const [hideNoData, setHideNoData] = useState(true)
  const [adminMenuOpen, setAdminMenuOpen] = useState(false)
  const [filmsManagerOpen, setFilmsManagerOpen] = useState(false)
  const adminMenuRef = useRef(null)

  const [selectedMovie, setSelectedMovie] = useState(null)
  const [budgetRows, setBudgetRows] = useState([])
  const [budgetLoading, setBudgetLoading] = useState(false)
  const [budgetError, setBudgetError] = useState(null)
  const [budgetRefresh, setBudgetRefresh] = useState(0)

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
  const [newMovieStudio, setNewMovieStudio] = useState(DEFAULT_STUDIO_OPTIONS[0])
  const [addMovieBusy, setAddMovieBusy] = useState(false)
  const [addMovieError, setAddMovieError] = useState(null)

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))

  const refreshMovies = useCallback(async () => {
    try {
      const [budgetRes, actualRes, rentalRes] = await Promise.allSettled([
        supabase.from('budgets').select('film_number, amount, planned_amount'),
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
      setActualExpensesRows([])
      setActualExpensesError(null)
      setIncomeRows([])
      setIncomeError(null)
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
        setBudgetRows(budgetResult.value)
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
          .select('film_number, title_en, title_he, studio, profit_center')
          .or(`title_en.ilike.%${needle}%,title_he.ilike.%${needle}%,film_number.ilike.%${needle}%,studio.ilike.%${needle}%,profit_center.ilike.%${needle}%`)
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

  function handleDragEnd(event) {
    const { active, over } = event
    if (!over || active.id === over.id) return

    setMovies((current) => {
      if (!Array.isArray(current)) return current
      const oldIndex = current.findIndex((m) => m.film_number === active.id)
      const newIndex = current.findIndex((m) => m.film_number === over.id)
      if (oldIndex === -1 || newIndex === -1) return current
      return arrayMove(current, oldIndex, newIndex)
    })
  }

  const brandBorder = 'border border-[rgba(74,20,140,0.2)]'

  const codeTagClass = `rounded ${brandBorder} bg-white/90 px-1.5 py-0.5 font-['JetBrains_Mono',ui-monospace,monospace] text-[0.7rem] font-medium text-[#6A5B88]`
  const studioFilterOptions = useMemo(() => {
    const merged = [...DEFAULT_STUDIO_OPTIONS]
    if (Array.isArray(movies)) {
      for (const m of movies) {
        const s = m.studio?.trim()
        if (s && !merged.includes(s)) merged.push(s)
      }
    }
    merged.sort((a, b) => a.localeCompare(b))
    return merged
  }, [movies])

  // Close admin menu on outside click
  useEffect(() => {
    if (!adminMenuOpen) return
    function handler(e) {
      if (adminMenuRef.current && !adminMenuRef.current.contains(e.target)) setAdminMenuOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [adminMenuOpen])

  const isSearching = searchTerm.trim() !== ''

  const filteredMovies = useMemo(() => {
    let base = isSearching
      ? [...searchResults]
      : Array.isArray(movies) ? [...movies] : []

    if (studioFilter !== '') {
      base = base.filter((m) => String(m.studio ?? '').trim() === studioFilter)
    }

    if (hideNoData && !isSearching) {
      base = base.filter((m) => {
        const hasBudget  = (movieBudgetTotals[m.film_number] ?? 0) > 0
        const hasActual  = (movieActualTotals[m.film_number] ?? 0) > 0
        const hasIncome  = (movieIncomeTotals[m.film_number] ?? 0) > 0
        return hasBudget || hasActual || hasIncome
      })
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
    movies, searchResults, isSearching, studioFilter, progressSort,
    hideNoData, movieBudgetTotals, movieActualTotals, movieIncomeTotals,
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
    setAddMovieBusy(true)
    try {
      const payload = {
        film_number:   code,
        title_en:      en || null,
        title_he:      he || null,
        studio,
        profit_center: newMovieProfitCenter.trim() || null,
      }
      const { data, error } = await supabase.from('films').insert(payload).select().single()
      if (error) throw error
      await refreshMovies()
      setSelectedMovie(data)
      setAddMovieOpen(false)
      setNewMovieHebrew('')
      setNewMovieEnglish('')
      setNewMovieCode('')
      setNewMovieProfitCenter('')
      setNewMovieStudio(DEFAULT_STUDIO_OPTIONS[0])
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
              {/* Logo + primary actions */}
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <img src={tulipLogo} alt="Tulip logo" className="h-10 w-10 shrink-0 rounded-md object-contain" />
                  <div>
                    <p className="flex items-baseline gap-2">
                      <span className="font-['Montserrat',sans-serif] text-xl font-extrabold tracking-[0.06em] text-[#4B4594]">TULIP</span>
                      <span className="font-['Montserrat',sans-serif] text-xl font-bold uppercase tracking-[0.08em] text-[#F9B233]">Flow</span>
                    </p>
                    <p className="mt-1 font-['Georgia',serif] text-[0.7rem] italic tracking-[0.16em] text-[#7B52AB]/65">Moving in sync</p>
                  </div>
                </div>

                {/* User + logout */}
                <div className="flex items-center gap-2 text-[11px] text-[#8A7BAB]">
                  <span className="hidden truncate max-w-[160px] sm:block" title={session.user?.email}>
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

                {/* Primary action buttons */}
                <div className="flex flex-wrap items-center gap-2">
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
                    label="Upload Budget"
                    onUploadSuccess={() => { setBudgetRefresh(n => n + 1); void refreshMovies() }}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-[#2FA36B] px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-white shadow-[0_8px_18px_rgba(47,163,107,0.35)] transition hover:bg-[#28915f]"
                  />

                  {/* Upload Monthly Journal */}
                  <ExcelUploadButton
                    initialType="journal"
                    label="Upload Monthly Journal"
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
                    {adminMenuOpen && (
                      <div className="absolute right-0 top-full z-50 mt-1.5 min-w-[200px] overflow-hidden rounded-xl border border-[rgba(74,20,140,0.15)] bg-white shadow-[0_16px_40px_rgba(74,20,140,0.18)]">
                        {/* Manage Films */}
                        <div className="border-b border-[rgba(74,20,140,0.08)] px-2 pb-2 pt-2">
                          <button
                            type="button"
                            onClick={() => { setAdminMenuOpen(false); setFilmsManagerOpen(true) }}
                            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[11px] font-semibold text-[#4B4594] transition hover:bg-[#F7F2FF]"
                          >
                            <Clapperboard className="h-3.5 w-3.5 shrink-0 text-[#4B4594]" aria-hidden />
                            Manage Films
                          </button>
                        </div>
                        <p className="px-3.5 pt-3 pb-1 text-[0.55rem] font-semibold uppercase tracking-[0.2em] text-[#8A7BAB]">Catalog Imports</p>
                        {[
                          { key: 'films',         label: 'Films list' },
                          { key: 'expenses',      label: 'Expenses catalog' },
                          { key: 'rentals',       label: 'Rentals catalog' },
                          { key: 'actual_expenses',      label: 'Monthly Expenses' },
                          { key: 'rental_transactions',  label: 'Monthly Income' },
                        ].map(({ key, label }) => (
                          <div key={key} className="px-2 py-0.5">
                            <ExcelUploadButton
                              initialType={key}
                              label={label}
                              onUploadSuccess={() => { setAdminMenuOpen(false); setBudgetRefresh(n => n + 1); void refreshMovies() }}
                              className="w-full rounded-lg px-2.5 py-2 text-left text-[11px] font-medium text-[#5B4B7A] transition hover:bg-[#F7F2FF] flex items-center gap-2"
                            />
                          </div>
                        ))}
                        <div className="p-2 pt-1" />
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </header>

            {/* Monthly summary row */}
            {movies !== null && !loadError && <DashboardSummaryRow />}

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
              <div className="grid min-w-0 grid-cols-1 items-start gap-[clamp(1.5rem,3vw,3rem)] lg:grid-cols-[minmax(300px,min(40%,34rem))_minmax(0,1fr)] xl:gap-x-[clamp(2rem,4vw,4rem)]">
              <section className="min-w-0" aria-label="Movies">
                <div
                  className={`rounded-2xl ${brandBorder} bg-white/88 p-4 shadow-[0_24px_55px_rgba(74,20,140,0.12)] backdrop-blur-md lg:sticky lg:top-[max(0.75rem,env(safe-area-inset-top))] lg:h-[min(calc(100dvh_-_1.5rem),calc(100dvh_-_env(safe-area-inset-top)_-_env(safe-area-inset-bottom)_-_1rem))]`}
                >
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <h2 className="text-[0.65rem] font-semibold uppercase tracking-[0.22em] text-[#4A148C]">
                      Active Films
                    </h2>
                    <div className="flex items-center gap-2">
                      {/* Sort by progress */}
                      <button
                        type="button"
                        onClick={() => setProgressSort(s => s === 'none' ? 'desc' : s === 'desc' ? 'asc' : 'none')}
                        className="inline-flex items-center gap-1 rounded-lg border border-[rgba(74,20,140,0.2)] bg-white/95 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-[#4A148C] transition hover:bg-[#F7F2FF]"
                        title="Sort by budget progress"
                      >
                        <ArrowUpDown className="h-3 w-3" aria-hidden />
                        {progressSort === 'none' ? 'Sort' : progressSort === 'desc' ? 'High%' : 'Low%'}
                      </button>
                      {/* Hide no-data toggle */}
                      <button
                        type="button"
                        onClick={() => setHideNoData(v => !v)}
                        className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.1em] transition ${hideNoData ? 'border-[#4B4594] bg-[#4B4594] text-white' : 'border-[rgba(74,20,140,0.2)] bg-white/95 text-[#4A148C] hover:bg-[#F7F2FF]'}`}
                        title="Toggle showing films with no financial data"
                      >
                        {hideNoData ? <Eye className="h-3 w-3" aria-hidden /> : <EyeOff className="h-3 w-3" aria-hidden />}
                        {hideNoData ? 'Active only' : 'All films'}
                      </button>
                    </div>
                  </div>

                  <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-stretch sm:gap-3">
                    <div
                      className={`flex min-h-[2.5rem] flex-1 items-center gap-2 rounded-xl ${brandBorder} bg-white/95 px-3 py-2 shadow-[0_6px_14px_rgba(74,20,140,0.08)]`}
                    >
                      {searchLoading
                        ? <Loader2 className="h-4 w-4 shrink-0 animate-spin text-[#4A148C]" aria-hidden />
                        : <Search className="h-4 w-4 shrink-0 text-[#4A148C]" aria-hidden />
                      }
                      <input
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        placeholder="Search all films by name, code, or studio…"
                        className="w-full min-w-0 bg-transparent text-sm text-[#5B4B7A] outline-none placeholder:text-[#9A8AB8]"
                      />
                      {searchTerm && (
                        <button
                          type="button"
                          onClick={() => setSearchTerm('')}
                          className="shrink-0 text-[#9A8AB8] hover:text-[#4A148C]"
                          aria-label="Clear search"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                    <div className="flex min-h-[2.5rem] shrink-0 items-center gap-2 sm:min-w-[11rem]">
                      <label
                        htmlFor="studio-name-filter"
                        className="whitespace-nowrap text-[10px] font-semibold uppercase tracking-[0.14em] text-[#4A148C]"
                      >
                        Studio
                      </label>
                      <select
                        id="studio-name-filter"
                        value={studioFilterOptions.includes(studioFilter) ? studioFilter : ''}
                        onChange={(e) => setStudioFilter(e.target.value)}
                        className={`w-full min-w-0 rounded-xl ${brandBorder} bg-white/95 px-2.5 py-2 text-xs font-medium text-[#5B4B7A] shadow-[0_6px_14px_rgba(74,20,140,0.08)] outline-none transition focus:border-[#4B4594] focus:ring-2 focus:ring-[#4B4594]/20 sm:max-w-[12rem]`}
                      >
                        <option value="">All studios</option>
                        {studioFilterOptions.map((opt) => (
                          <option key={opt} value={opt}>
                            {opt}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {filteredMovies.length === 0 ? (
                    <p className="py-6 text-center text-sm text-[#4A148C]">
                      {movies.length === 0
                        ? 'No movies yet. Use “Add new movie” to create a title.'
                        : 'No films match the current studio filter.'}
                    </p>
                  ) : (
                    <div className="movie-list-scroll lg:h-[calc(100%-6.5rem)] lg:overflow-y-auto lg:pr-1">
                      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                        <SortableContext
                          items={filteredMovies.map((m) => m.film_number)}
                          strategy={verticalListSortingStrategy}
                        >
                          <ul className="grid gap-2.5">
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
                        </SortableContext>
                      </DndContext>
                    </div>
                  )}

                  <p className="mt-3 text-[11px] text-[#8A7BAB]">
                    Drag cards to rearrange. Order stays in local state for this session.
                  </p>
                </div>
              </section>

              <section
                className="min-w-0 rounded-2xl border border-[rgba(74,20,140,0.16)] bg-white/96 shadow-[0_24px_56px_rgba(230,30,110,0.09)] backdrop-blur-sm lg:sticky lg:top-[max(0.75rem,env(safe-area-inset-top))] lg:max-h-[min(calc(100dvh_-_1.5rem),calc(100dvh_-_env(safe-area-inset-top)_-_env(safe-area-inset-bottom)_-_1rem))] lg:overflow-y-auto lg:overscroll-contain lg:self-start"
                aria-labelledby="budget-overview-heading"
              >
                {!selectedMovie && (
                  <div className="flex min-h-[min(22rem,45dvh)] flex-col items-center justify-center px-[clamp(1.5rem,4vw,2.5rem)] py-[clamp(2.5rem,8vh,5rem)] text-center">
                    <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-2xl border border-[rgba(74,20,140,0.2)] bg-gradient-to-br from-[#F4EFFF] to-[#FFF2E4] text-[#4A148C] shadow-[0_10px_26px_rgba(74,20,140,0.12)]">
                      <Clapperboard className="h-8 w-8" strokeWidth={1.5} aria-hidden />
                    </div>
                    <p className="max-w-sm text-sm leading-relaxed text-[#7C6D98]">
                      Select a title from the movies to open the budget overview and category
                      breakdown.
                    </p>
                  </div>
                )}

                {selectedMovie && (
                  <>
                    <div className="min-w-0 border-b border-[rgba(74,20,140,0.16)] px-4 py-6 sm:px-8 sm:py-8">
                      <h2
                        id="budget-overview-heading"
                        className="text-[0.65rem] font-semibold uppercase tracking-[0.22em] text-[#4A148C]"
                      >
                        Budget overview
                      </h2>
                      <p className="mt-3 break-words font-['Montserrat',sans-serif] text-2xl font-extrabold tracking-tight text-[#4A148C]">
                        {movieTitleEnglish(selectedMovie)}
                      </p>
                      {movieTitleHebrewSubtitle(selectedMovie) ? (
                        <p
                          className="mt-2 max-w-prose break-words text-left text-sm leading-snug text-[#9A8AB8]"
                          lang="he"
                        >
                          {movieTitleHebrewSubtitle(selectedMovie)}
                        </p>
                      ) : null}
                      <p className="mt-2 break-words text-sm font-medium text-[#6A5B88]">
                        {movieStudioAndCodeLabel(selectedMovie)}
                      </p>
                      {selectedMovie.profit_center && (
                        <p className="mt-1 text-xs text-[#9A8AB8]">
                          Profit Center&nbsp;
                          <span className="font-['JetBrains_Mono',ui-monospace,monospace] font-semibold text-[#7B52AB]">
                            {selectedMovie.profit_center}
                          </span>
                        </p>
                      )}
                      {/* Budget vs Actual mini-KPI in detail header */}
                      {!budgetLoading && !budgetError && budgetRows.length > 0 && (() => {
                        const filmBudget  = movieBudgetTotals[selectedMovie?.film_number] ?? 0
                        const filmSpent   = movieMarketingTotals[selectedMovie?.film_number] ?? 0
                        const filmIncome  = movieIncomeTotals[selectedMovie?.film_number] ?? 0
                        const variance    = filmBudget - filmSpent
                        return (
                          <div className="mt-4 grid grid-cols-3 gap-2 text-center">
                            {[
                              { label: 'Planned Budget', value: filmBudget, color: '#4B4594' },
                              { label: 'Total Spent',    value: filmSpent,  color: '#C0392B' },
                              { label: 'Total Revenue',  value: filmIncome, color: '#0EA5A0' },
                            ].map(({ label, value, color }) => (
                              <div key={label} className="rounded-xl border border-[rgba(74,20,140,0.1)] bg-white p-2.5">
                                <p className="text-[0.55rem] font-semibold uppercase tracking-[0.12em] text-[#8A7BAB]">{label}</p>
                                <p className="mt-1 font-['Montserrat',sans-serif] text-sm font-extrabold tabular-nums" style={{ color }}>
                                  {formatCurrency(value)}
                                </p>
                              </div>
                            ))}
                            {variance < 0 && (
                              <div className="col-span-3 rounded-lg bg-[#FFE5EC] px-3 py-2 text-center">
                                <span className="text-sm font-bold text-[#C0004C]">⚠ Over budget by {formatCurrency(Math.abs(variance))}</span>
                              </div>
                            )}
                          </div>
                        )
                      })()}
                    </div>

                    <div className="px-8 pb-10 pt-4">
                      {budgetLoading && (
                        <p className="py-12 text-center text-sm text-[#8A7BAB]">Loading figures…</p>
                      )}

                      {budgetError && (
                        <p
                          className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-100"
                          role="alert"
                        >
                          {budgetError}
                        </p>
                      )}

                      {!budgetLoading && !budgetError && budgetRows.length === 0 && (
                        <p className="py-8 text-sm leading-relaxed text-[#8A7BAB]">
                          No budget or expense data yet for this film. Use the{' '}
                          <span className="font-semibold text-[#4B4594]">Import</span> button to
                          upload Budgets or Expenses, or save a row manually above.
                        </p>
                      )}

                      {!budgetLoading && !budgetError && budgetRows.length > 0 && (() => {
                        // Build actual totals by media_budget_code from marketing rows only
                        const actualByCode = {}
                        for (const r of (actualExpensesRows ?? []).filter(r => !isPrintCode(r.priority_code))) {
                          const code = r.media_budget_code?.trim() || '__none__'
                          actualByCode[code] = (actualByCode[code] ?? 0) + (Number(r.actual_amount) || 0)
                        }

                        const grandBudget   = budgetRows.reduce((s, r) => s + r.budget, 0)
                        const grandActual   = budgetRows.reduce((s, r) => s + (actualByCode[r.mediaCode] ?? actualByCode['__none__'] ?? 0), 0)
                        const grandVariance = grandBudget - grandActual

                        return (
                          <div className="rounded-xl border border-[rgba(74,20,140,0.14)] bg-white">
                            <table className="w-full border-collapse text-xs">
                              <thead>
                                <tr className="border-b border-[rgba(74,20,140,0.12)] bg-[#F7F2FF]">
                                  <th className="px-3 py-2.5 text-left text-[0.58rem] font-semibold uppercase tracking-[0.14em] text-[#4A148C]">
                                    Budget Item
                                  </th>
                                  <th className="px-2 py-2.5 text-right text-[0.58rem] font-semibold uppercase tracking-[0.14em] text-[#4A148C]">
                                    Planned
                                  </th>
                                  <th className="px-2 py-2.5 text-right text-[0.58rem] font-semibold uppercase tracking-[0.14em] text-[#4A148C]">
                                    Actual
                                  </th>
                                  <th className="px-3 py-2.5 text-right text-[0.58rem] font-semibold uppercase tracking-[0.14em] text-[#4A148C]">
                                    Variance
                                  </th>
                                </tr>
                              </thead>
                              <tbody>
                                {budgetRows.map((row) => {
                                  const actual   = row.mediaCode ? (actualByCode[row.mediaCode] ?? 0) : 0
                                  const variance = row.budget - actual
                                  return (
                                    <tr key={row.categoryId}
                                        className="border-b border-[rgba(74,20,140,0.07)] last:border-0 hover:bg-[#FDFAFF]">
                                      {/* Name + code chip + mini bar */}
                                      <td className="px-3 py-2.5">
                                        <p className="truncate font-medium leading-tight text-[#5B4B7A]"
                                           style={{ maxWidth: '11rem' }}>
                                          {row.categoryName}
                                        </p>
                                        {row.mediaCode && (
                                          <span className="mt-0.5 inline-block rounded bg-[#EDE8F8] px-1.5 py-px font-['JetBrains_Mono',ui-monospace,monospace] text-[9px] font-semibold text-[#4A148C]">
                                            {row.mediaCode}
                                          </span>
                                        )}
                                      </td>
                                      <td className="px-2 py-2.5 text-right font-['Montserrat',sans-serif] tabular-nums text-[#4B4594]">
                                        {formatCurrency(row.budget)}
                                      </td>
                                      <td className="px-2 py-2.5 text-right font-['Montserrat',sans-serif] tabular-nums"
                                          style={{ color: actual > 0 ? '#C0392B' : '#C4B8D8' }}>
                                        {actual > 0 ? formatCurrency(actual) : '—'}
                                      </td>
                                      <td className={`px-3 py-2.5 text-right font-['Montserrat',sans-serif] font-semibold tabular-nums ${actual > 0 ? varianceCellClass(variance) : 'text-[#C4B8D8]'}`}>
                                        {actual > 0 ? formatCurrency(variance) : '—'}
                                      </td>
                                    </tr>
                                  )
                                })}
                              </tbody>
                              <tfoot>
                                <tr className="border-t-2 border-[rgba(74,20,140,0.18)] bg-[#F7F2FF]">
                                  <td className="px-3 py-2.5 text-[0.65rem] font-bold text-[#4A148C]">
                                    Total
                                  </td>
                                  <td className="px-2 py-2.5 text-right font-['Montserrat',sans-serif] font-extrabold tabular-nums text-[#4B4594]">
                                    {formatCurrency(grandBudget)}
                                  </td>
                                  <td className="px-2 py-2.5 text-right font-['Montserrat',sans-serif] font-extrabold tabular-nums text-[#C0392B]">
                                    {grandActual > 0 ? formatCurrency(grandActual) : '—'}
                                  </td>
                                  <td className={`px-3 py-2.5 text-right font-['Montserrat',sans-serif] font-extrabold tabular-nums ${grandActual > 0 ? varianceCellClass(grandVariance) : 'text-[#C4B8D8]'}`}>
                                    {grandActual > 0 ? formatCurrency(grandVariance) : '—'}
                                  </td>
                                </tr>
                              </tfoot>
                            </table>
                          </div>
                        )
                      })()}
                    </div>

                    {/* ── Actual Expenses section ───────────────────────── */}
                    <div className="border-t border-[rgba(74,20,140,0.1)] px-4 pb-6 pt-6 sm:px-8">
                      <div className="mb-4 flex items-center gap-2">
                        <Receipt className="h-4 w-4 text-[#C0392B]" aria-hidden />
                        <h3 className="text-[0.65rem] font-semibold uppercase tracking-[0.2em] text-[#C0392B]">
                          Actual Expenses
                        </h3>
                      </div>

                      {actualExpensesLoading && (
                        <p className="py-6 text-center text-sm text-[#8A7BAB]">Loading expenses…</p>
                      )}

                      {actualExpensesError && (
                        <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">
                          {actualExpensesError}
                        </p>
                      )}

                      {!actualExpensesLoading && !actualExpensesError && actualExpensesRows.filter(r => !isPrintCode(r.priority_code)).length === 0 && (
                        <p className="py-4 text-sm text-[#8A7BAB]">
                          No expense records yet. Use{' '}
                          <span className="font-semibold text-[#4B4594]">Import → Monthly Expenses</span>{' '}
                          to upload monthly actual expense data.
                        </p>
                      )}

                      {!actualExpensesLoading && !actualExpensesError && actualExpensesRows.filter(r => !isPrintCode(r.priority_code)).length > 0 && (() => {
                        const marketingRows  = actualExpensesRows.filter(r => !isPrintCode(r.priority_code))
                        const totalMarketing = marketingRows.reduce((s, r) => s + (Number(r.actual_amount) || 0), 0)
                        const totalBudget    = movieBudgetTotals[selectedMovie?.film_number] ?? 0
                        const balance        = totalBudget - totalMarketing

                        const ExpenseTable = ({ rows, accentColor }) => (
                          <div className="overflow-x-auto rounded-xl border [-webkit-overflow-scrolling:touch]" style={{ borderColor: `${accentColor}28` }}>
                            <table className="w-full min-w-[22rem] border-collapse text-sm">
                              <thead>
                                <tr className="border-b" style={{ borderColor: `${accentColor}20`, background: `${accentColor}0d` }}>
                                  {[
                                    { label: 'Media Budget Code', hide: false, right: false },
                                    { label: 'Description',       hide: true,  right: false },
                                    { label: 'Month',             hide: false, right: false },
                                    { label: 'Amount',            hide: false, right: true  },
                                  ].map(({ label, hide, right }) => (
                                    <th key={label}
                                        className={`px-3 py-2.5 text-[0.6rem] font-semibold uppercase tracking-[0.14em] ${right ? 'text-right' : 'text-left'} ${hide ? 'hidden sm:table-cell' : ''}`}
                                        style={{ color: accentColor }}>{label}</th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody>
                                {rows.map((row, i) => {
                                  const mediaCode = row.media_budget_code?.trim()
                                    || (row.priority_code ? `[${row.priority_code}]` : 'Unmapped')
                                  const isMapped  = !!(row.media_budget_code?.trim())
                                  return (
                                    <tr key={i} className="border-b last:border-0 transition hover:opacity-80" style={{ borderColor: `${accentColor}0f` }}>
                                      <td className="px-3 py-2 font-['JetBrains_Mono',ui-monospace,monospace] text-xs font-semibold tabular-nums"
                                          style={{ color: isMapped ? accentColor : '#9A6B00' }}>
                                        {mediaCode}
                                        {!isMapped && (
                                          <span className="ml-1 rounded bg-amber-100 px-1 py-px text-[10px] font-normal text-amber-700">unmapped</span>
                                        )}
                                      </td>
                                      <td className="hidden max-w-[14rem] truncate px-3 py-2 text-[11px] text-[#8A7BAB] sm:table-cell">
                                        {row.expense_description}
                                      </td>
                                      <td className="px-3 py-2 font-['JetBrains_Mono',ui-monospace,monospace] text-xs tabular-nums text-[#8A7BAB]">{row.month_period?.slice(0,7) ?? '—'}</td>
                                      <td className="px-3 py-2 text-right font-['Montserrat',sans-serif] text-sm font-semibold tabular-nums" style={{ color: accentColor }}>{formatCurrency(row.actual_amount)}</td>
                                    </tr>
                                  )
                                })}
                              </tbody>
                              <tfoot>
                                <tr className="border-t-2" style={{ borderColor: `${accentColor}30`, background: `${accentColor}0d` }}>
                                  <td colSpan={2} className="hidden px-3 py-2 text-xs font-bold sm:table-cell" style={{ color: accentColor }}>Total</td>
                                  <td className="px-3 py-2 text-xs font-bold sm:hidden" style={{ color: accentColor }}>Total</td>
                                  <td className="px-3 py-2 text-right font-['Montserrat',sans-serif] text-sm font-extrabold tabular-nums" style={{ color: accentColor }}>
                                    {formatCurrency(rows.reduce((s,r) => s + (Number(r.actual_amount)||0), 0))}
                                  </td>
                                </tr>
                              </tfoot>
                            </table>
                          </div>
                        )

                        return (
                          <>
                            {/* Summary cards */}
                            <div className="mb-5 grid grid-cols-3 gap-3">
                              {[
                                { label: 'Planned Budget', value: totalBudget,    color: '#4B4594' },
                                { label: 'Total Spent',    value: totalMarketing, color: '#C0392B' },
                                { label: 'Balance',        value: balance,        color: balance >= 0 ? '#2FA36B' : '#E61E6E' },
                              ].map(({ label, value, color }) => (
                                <div key={label} className="rounded-xl border border-[rgba(74,20,140,0.1)] bg-white px-3 py-3 text-center">
                                  <p className="text-[0.55rem] font-semibold uppercase tracking-[0.14em] text-[#8A7BAB]">{label}</p>
                                  <p className="mt-1 font-['Montserrat',sans-serif] text-sm font-extrabold tabular-nums" style={{ color }}>
                                    {formatCurrency(value)}
                                  </p>
                                </div>
                              ))}
                            </div>

                            {marketingRows.length === 0
                              ? <p className="py-3 text-center text-xs text-[#8A7BAB]">No expenses recorded.</p>
                              : <ExpenseTable rows={marketingRows} accentColor="#C0392B" />
                            }
                          </>
                        )
                      })()}
                    </div>

                    {/* ── Rental Income section ─────────────────────────── */}
                    <div className="border-t border-[rgba(74,20,140,0.1)] px-4 pb-10 pt-6 sm:px-8">
                      <div className="mb-4 flex items-center gap-2">
                        <TrendingUp className="h-4 w-4 text-[#0EA5A0]" aria-hidden />
                        <h3 className="text-[0.65rem] font-semibold uppercase tracking-[0.2em] text-[#0EA5A0]">
                          Rental Income
                        </h3>
                      </div>

                      {incomeLoading && (
                        <p className="py-6 text-center text-sm text-[#8A7BAB]">Loading income…</p>
                      )}

                      {incomeError && (
                        <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">
                          {incomeError}
                        </p>
                      )}

                      {!incomeLoading && !incomeError && incomeRows.length === 0 && (
                        <p className="py-4 text-sm text-[#8A7BAB]">
                          No income records yet. Use{' '}
                          <span className="font-semibold text-[#4B4594]">Import → Income</span>{' '}
                          to upload monthly rental transactions.
                        </p>
                      )}

                      {!incomeLoading && !incomeError && incomeRows.length > 0 && (() => {
                        const grandTotal = incomeRows.reduce((s, r) => s + (Number(r.actual_amount) || 0), 0)

                        // Group by category (income_description)
                        const byCategory = new Map()
                        for (const r of incomeRows) {
                          const key = r.income_description || r.priority_code || '—'
                          if (!byCategory.has(key)) byCategory.set(key, { rows: [], total: 0, format_type: r.format_type })
                          const cat = byCategory.get(key)
                          cat.rows.push(r)
                          cat.total += Number(r.actual_amount) || 0
                        }

                        // Group by month for the monthly summary strip
                        const byMonth = new Map()
                        for (const r of incomeRows) {
                          const m = r.month_period?.slice(0, 7) ?? '—'
                          byMonth.set(m, (byMonth.get(m) ?? 0) + (Number(r.actual_amount) || 0))
                        }
                        const sortedMonths = [...byMonth.entries()].sort((a, b) => a[0].localeCompare(b[0]))

                        return (
                          <>
                            {/* KPI strip */}
                            <div className="mb-4 grid grid-cols-3 gap-2 rounded-xl border border-[rgba(14,165,160,0.2)] bg-[#F0FAFA] px-4 py-3 text-center">
                              <div>
                                <p className="text-[0.58rem] font-semibold uppercase tracking-[0.14em] text-[#0EA5A0]">Total Revenue</p>
                                <p className="mt-0.5 font-['Montserrat',sans-serif] text-base font-extrabold tabular-nums text-[#0C8A86]">
                                  {formatCurrency(grandTotal)}
                                </p>
                              </div>
                              <div>
                                <p className="text-[0.58rem] font-semibold uppercase tracking-[0.14em] text-[#0EA5A0]">Categories</p>
                                <p className="mt-0.5 font-semibold tabular-nums text-[#0C8A86]">{byCategory.size}</p>
                              </div>
                              <div>
                                <p className="text-[0.58rem] font-semibold uppercase tracking-[0.14em] text-[#0EA5A0]">Months</p>
                                <p className="mt-0.5 font-semibold tabular-nums text-[#0C8A86]">{byMonth.size}</p>
                              </div>
                            </div>

                            {/* Monthly breakdown strip */}
                            {sortedMonths.length > 1 && (
                              <div className="mb-4 flex flex-wrap gap-2">
                                {sortedMonths.map(([month, total]) => (
                                  <div key={month} className="flex-1 min-w-[80px] rounded-lg border border-[rgba(14,165,160,0.18)] bg-white px-3 py-2 text-center">
                                    <p className="text-[9px] font-semibold uppercase tracking-[0.12em] text-[#8A7BAB]">{month}</p>
                                    <p className="mt-0.5 font-['Montserrat',sans-serif] text-xs font-bold tabular-nums text-[#0C8A86]">
                                      {formatCurrency(total)}
                                    </p>
                                  </div>
                                ))}
                              </div>
                            )}

                            {/* Summary table by category */}
                            <div className="overflow-x-auto rounded-xl border border-[rgba(14,165,160,0.18)] bg-white [-webkit-overflow-scrolling:touch]">
                              <table className="w-full min-w-[22rem] border-collapse text-sm">
                                <thead>
                                  <tr className="border-b border-[rgba(14,165,160,0.14)] bg-[#F0FAFA]">
                                    <th className="px-3 py-3 text-left text-[0.62rem] font-semibold uppercase tracking-[0.14em] text-[#0EA5A0]">Category</th>
                                    <th className="hidden px-3 py-3 text-left text-[0.62rem] font-semibold uppercase tracking-[0.14em] text-[#0EA5A0] sm:table-cell">Format</th>
                                    <th className="px-3 py-3 text-center text-[0.62rem] font-semibold uppercase tracking-[0.14em] text-[#0EA5A0]">Entries</th>
                                    <th className="px-3 py-3 text-right text-[0.62rem] font-semibold uppercase tracking-[0.14em] text-[#0EA5A0]">Total</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {[...byCategory.entries()].map(([label, { rows, total, format_type }]) => (
                                    <tr key={label} className="border-b border-[rgba(14,165,160,0.07)] last:border-0 hover:bg-[#F5FDFD]">
                                      <td className="max-w-[14rem] px-3 py-2.5 font-medium text-[#0C8A86]">{label}</td>
                                      <td className="hidden px-3 py-2.5 text-[11px] text-[#6A5B88] sm:table-cell">{format_type || '—'}</td>
                                      <td className="px-3 py-2.5 text-center text-xs tabular-nums text-[#6A5B88]">{rows.length}</td>
                                      <td className="px-3 py-2.5 text-right font-['Montserrat',sans-serif] text-sm font-semibold tabular-nums text-[#0C8A86]">
                                        {formatCurrency(total)}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                                <tfoot>
                                  <tr className="border-t-2 border-[rgba(14,165,160,0.25)] bg-[#F0FAFA]">
                                    <td colSpan={2} className="hidden px-3 py-2.5 text-xs font-bold text-[#0EA5A0] sm:table-cell">Grand Total</td>
                                    <td className="px-3 py-2.5 text-xs font-bold text-[#0EA5A0] sm:hidden">Total</td>
                                    <td className="px-3 py-2.5 text-center text-xs font-semibold tabular-nums text-[#0EA5A0]">{incomeRows.length}</td>
                                    <td className="px-3 py-2.5 text-right font-['Montserrat',sans-serif] text-sm font-extrabold tabular-nums text-[#0C8A86]">
                                      {formatCurrency(grandTotal)}
                                    </td>
                                  </tr>
                                </tfoot>
                              </table>
                            </div>
                          </>
                        )
                      })()}

                      {/* ── Accumulated Trend Chart ─────────────────── */}
                      {(actualExpensesRows.length > 0 || incomeRows.length > 0) && (
                        <div className="mt-6">
                          <div className="mb-3 flex items-center gap-2">
                            <TrendingUp className="h-4 w-4 text-[#4B4594]" aria-hidden />
                            <p className="text-[0.6rem] font-semibold uppercase tracking-[0.2em] text-[#4A148C]">
                              Accumulated Trend
                            </p>
                          </div>
                          <div className="rounded-xl border border-[rgba(74,20,140,0.12)] bg-[#FAFAFE] p-4">
                            <TrendChart filmNumber={selectedMovie.film_number} />
                            <div className="mt-2 flex items-center gap-4 justify-center">
                              <span className="flex items-center gap-1.5 text-[10px] text-[#8A7BAB]">
                                <span className="inline-block h-2 w-4 rounded-full bg-[#C0392B]" /> Accum. Expenses
                              </span>
                              <span className="flex items-center gap-1.5 text-[10px] text-[#8A7BAB]">
                                <span className="inline-block h-2 w-4 rounded-full bg-[#0EA5A0]" /> Accum. Revenue
                              </span>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  </>
                )}
              </section>
            </div>
            </>
          )}
        </div>
      </main>

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
            className="relative z-10 w-full max-w-md rounded-2xl border border-[rgba(74,20,140,0.2)] bg-white p-6 shadow-[0_28px_60px_rgba(74,20,140,0.22)]"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="mb-5 flex items-start justify-between gap-3">
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

            <form onSubmit={handleAddMovieSubmit} className="space-y-3.5">

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

      {/* Footer — pinned to bottom of the viewport */}
      <footer className="fixed bottom-0 inset-x-0 z-40 border-t border-[rgba(74,20,140,0.1)] bg-white/80 py-2.5 text-center backdrop-blur-sm">
        <p className="text-[11px] text-[#B0A4CC]">
          Built with <span className="text-[#E61E6E]">❤️</span>{' '}
          by <span className="font-semibold text-[#4B4594]">Y.Tishler</span>
        </p>
      </footer>
    </div>
  )
}
