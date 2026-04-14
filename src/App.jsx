import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { DndContext, PointerSensor, closestCenter, useSensor, useSensors } from '@dnd-kit/core'
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { ArrowUpDown, Calendar, Clapperboard, Loader2, Plus, Search, Upload, X } from 'lucide-react'
import Papa from 'papaparse'
import { supabase } from './lib/supabaseClient'
import tulipLogo from './assets/tulip-logo.png'

/** @typedef {import('./types/movie').Movie} Movie */

const CSV_REQUIRED_HEADERS = ['movie_code', 'category_name', 'amount', 'date']

/** Fixed studio name options for the add-movie form */
const DEFAULT_STUDIO_OPTIONS = ['Universal', 'Paramount', 'Other']

/** Primary label: English, else Hebrew */
function movieTitleEnglish(movie) {
  const en = movie?.movie_name_en?.trim()
  const he = movie?.movie_name_he?.trim()
  return en || he || 'Untitled'
}

/** Hebrew subtitle when both EN and HE exist; otherwise empty */
function movieTitleHebrewSubtitle(movie) {
  const en = movie?.movie_name_en?.trim()
  const he = movie?.movie_name_he?.trim()
  return en && he ? he : ''
}

function normalizeCsvHeader(h) {
  return String(h ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
}

function parseExpenseDateForDb(value) {
  if (value == null || String(value).trim() === '') return null
  const s = String(value).trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return null
  return d.toISOString().slice(0, 10)
}

async function fetchLookupMaps() {
  const [moviesRes, catsRes] = await Promise.all([
    supabase.from('movies').select('id, movie_code'),
    supabase.from('expense_categories').select('id, category_name'),
  ])
  if (moviesRes.error) throw new Error(moviesRes.error.message)
  if (catsRes.error) throw new Error(catsRes.error.message)

  const movieByCode = new Map()
  for (const m of moviesRes.data ?? []) {
    if (m.movie_code != null && String(m.movie_code).trim() !== '') {
      movieByCode.set(String(m.movie_code).trim(), m.id)
    }
  }

  const categoryByNameLower = new Map()
  for (const c of catsRes.data ?? []) {
    const k = String(c.category_name).trim().toLowerCase()
    if (!categoryByNameLower.has(k)) categoryByNameLower.set(k, c.id)
  }

  return { movieByCode, categoryByNameLower }
}

function validateRowsToInserts(parsedRows, movieByCode, categoryByNameLower) {
  const errors = []
  const inserts = []
  /** Last wins per resolved movie UUID for optional CSV name columns */
  const movieNamePatches = new Map()

  parsedRows.forEach((row, index) => {
    const line = index + 2
    const movieCode = row.movie_code != null ? String(row.movie_code).trim() : ''
    const catName = row.category_name != null ? String(row.category_name).trim() : ''
    const amountRaw = row.amount
    const dateRaw = row.date
    const description = row.description != null ? String(row.description) : ''
    const nameEnOpt = row.movie_name_en != null ? String(row.movie_name_en).trim() : ''
    const nameHeOpt = row.movie_name_he != null ? String(row.movie_name_he).trim() : ''

    if (!movieCode) {
      errors.push(`Row ${line}: movie_code is empty`)
      return
    }
    if (!catName) {
      errors.push(`Row ${line}: category_name is empty`)
      return
    }

    const amount = Number(String(amountRaw).replace(/,/g, ''))
    if (Number.isNaN(amount)) {
      errors.push(`Row ${line}: invalid amount "${amountRaw}"`)
      return
    }

    const expenseDate = parseExpenseDateForDb(dateRaw)
    if (!expenseDate) {
      errors.push(`Row ${line}: invalid or missing date "${dateRaw ?? ''}"`)
      return
    }

    const movieUuid = movieByCode.get(movieCode)
    if (!movieUuid) {
      errors.push(`Row ${line}: no movie found with movie_code "${movieCode}"`)
      return
    }

    const categoryId = categoryByNameLower.get(catName.toLowerCase())
    if (!categoryId) {
      errors.push(`Row ${line}: no category named "${catName}"`)
      return
    }

    if (nameEnOpt || nameHeOpt) {
      const patch = {}
      if (nameEnOpt) patch.movie_name_en = nameEnOpt
      if (nameHeOpt) patch.movie_name_he = nameHeOpt
      movieNamePatches.set(movieUuid, { ...movieNamePatches.get(movieUuid), ...patch })
    }

    inserts.push({
      movie_id: movieUuid, // FK → movies.id (UUID); CSV matches on movie_code
      category_id: categoryId,
      amount,
      expense_date: expenseDate,
      description: description.trim() === '' ? null : description.trim(),
    })
  })

  return { errors, inserts, movieNamePatches }
}

async function insertActualExpensesInChunks(inserts, chunkSize = 200) {
  for (let i = 0; i < inserts.length; i += chunkSize) {
    const chunk = inserts.slice(i, i + chunkSize)
    const { error } = await supabase.from('actual_expenses').insert(chunk)
    if (error) throw new Error(error.message)
  }
}

/** Studio name and production movie_code, e.g. "Universal • 4040394" */
function movieStudioAndCodeLabel(movie) {
  const studio = movie.studio_name?.trim()
  const code = movie.movie_code?.trim()
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
  return `$${formatMoney(value)}`
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

function mergeBudgetAndActuals(budgetRows, actualRows, categories) {
  const byCat = new Map()
  for (const c of categories) {
    byCat.set(c.id, {
      categoryId: c.id,
      categoryName: c.category_name,
      budget: 0,
      actual: 0,
    })
  }

  for (const b of budgetRows) {
    const row = byCat.get(b.category_id)
    if (row) row.budget = Number(b.budgeted_amount) || 0
  }

  for (const a of actualRows) {
    const row = byCat.get(a.category_id)
    if (row) row.actual += Number(a.amount) || 0
  }

  return [...byCat.values()]
    .map((row) => ({
      ...row,
      variance: row.budget - row.actual,
    }))
    .sort((a, b) => a.categoryName.localeCompare(b.categoryName))
}

async function fetchBudgetRows(movieUuid) {
  const { data: allCats, error: catErr } = await supabase
    .from('expense_categories')
    .select('id, category_name')
    .order('category_name')

  if (catErr) throw new Error(catErr.message)
  const categories = allCats ?? []
  if (categories.length === 0) return []

  const [budgetRes, actualRes] = await Promise.all([
    supabase.from('budgets').select('budgeted_amount, category_id').eq('movie_id', movieUuid),
    supabase.from('actual_expenses').select('category_id, amount').eq('movie_id', movieUuid),
  ])

  if (budgetRes.error) throw new Error(budgetRes.error.message)
  if (actualRes.error) throw new Error(actualRes.error.message)

  return mergeBudgetAndActuals(budgetRes.data ?? [], actualRes.data ?? [], categories)
}

function SortableMovieCard({ movie, totalBudget, actualSpent, isSelected, onSelect }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: movie.id,
  })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  }
  const spentRatio = totalBudget > 0 ? Math.min((actualSpent / totalBudget) * 100, 100) : actualSpent > 0 ? 100 : 0
  const isOverBudget = totalBudget > 0 && actualSpent > totalBudget
  const overBy = Math.max(actualSpent - totalBudget, 0)
  const isAt90 = !isOverBudget && spentRatio >= 90
  const isAt80 = !isOverBudget && spentRatio >= 80 && spentRatio < 90

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
      aria-label={`Open budget overview for ${movieTitleEnglish(movie)}${movieTitleHebrewSubtitle(movie) ? ` — ${movieTitleHebrewSubtitle(movie)}` : ''}`}
    >
      <div className="mb-3 grid grid-cols-[1fr_auto] gap-3">
        <div className="min-w-0">
          <h3 className="truncate font-['Montserrat',sans-serif] text-base font-bold leading-tight text-[#F9B233]">
            {movieTitleEnglish(movie)}
          </h3>
          {movieTitleHebrewSubtitle(movie) ? (
            <p
              className="mt-0.5 truncate text-[11px] leading-snug text-[#9A8AB8]"
              dir="rtl"
              lang="he"
            >
              {movieTitleHebrewSubtitle(movie)}
            </p>
          ) : null}
          <p className="mt-1 truncate text-[11px] font-medium tracking-wide text-[#6A5B88]">
            {movieStudioAndCodeLabel(movie)}
          </p>
        </div>
        <div className="text-right">
          <span className="font-['Montserrat',sans-serif] text-sm font-semibold tracking-wide text-[#F9B233]">
            {formatCurrency(totalBudget)}
          </span>
          <p className="mt-1 text-[10px] text-[#8A7BAB]">Budget</p>
        </div>
      </div>
      <div className="mb-2 flex items-center justify-between gap-3">
        <div className="inline-flex min-w-0 items-center gap-1.5 text-[11px] text-[#8A7BAB]">
          <Calendar className="h-3.5 w-3.5 shrink-0 text-[#F9B233]" aria-hidden />
          <span className="truncate">{formatReleaseDate(movie.release_date)}</span>
        </div>
        <div className="text-[11px] text-[#8A7BAB]">
          Spent: <span className="tabular-nums text-[#6A5B88]">{formatCurrency(actualSpent)}</span>
        </div>
      </div>
      <div
        className={`h-2 w-full overflow-hidden rounded-full ${
          isOverBudget ? 'bg-[#FFE5EC] ring-1 ring-[#E61E6E]/35' : 'bg-[#F2E9FF]'
        }`}
      >
        <div
          className={`h-full rounded-full transition-all ${
            isOverBudget
              ? 'bg-gradient-to-r from-[#E61E6E] to-[#FF6B8A]'
              : isAt90
                ? 'bg-[#C65A00]'
                : isAt80
                  ? 'bg-[#FF8A00]'
              : 'bg-gradient-to-r from-[#7B52AB] via-[#E61E6E] to-[#F9B233]'
          }`}
          style={{ width: `${spentRatio}%` }}
        />
      </div>
      {isAt80 && (
        <p className="mt-1.5 text-right text-[10px] font-semibold tracking-wide text-[#FF8A00]">
          80% budget reached
        </p>
      )}
      {isAt90 && (
        <p className="mt-1.5 text-right text-[10px] font-semibold tracking-wide text-[#C65A00]">
          90% budget reached
        </p>
      )}
      {isOverBudget && (
        <p className="mt-1.5 text-right text-[10px] font-semibold tracking-wide text-[#E61E6E]">
          Over budget by {formatCurrency(overBy)}
        </p>
      )}
    </button>
  )
}

export default function App() {
  const fileInputRef = useRef(null)

  const [movies, setMovies] = useState(null)
  const [movieBudgetTotals, setMovieBudgetTotals] = useState({})
  const [movieActualTotals, setMovieActualTotals] = useState({})
  const [loadError, setLoadError] = useState(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [studioFilter, setStudioFilter] = useState('')
  const [progressSort, setProgressSort] = useState('none')

  const [selectedMovie, setSelectedMovie] = useState(null)
  const [budgetRows, setBudgetRows] = useState([])
  const [budgetLoading, setBudgetLoading] = useState(false)
  const [budgetError, setBudgetError] = useState(null)
  const [budgetRefresh, setBudgetRefresh] = useState(0)
  const [categoryAmountDrafts, setCategoryAmountDrafts] = useState({})
  const [savingCategoryId, setSavingCategoryId] = useState(null)

  const [uploadBusy, setUploadBusy] = useState(false)
  const [uploadFeedback, setUploadFeedback] = useState(null)

  const [addMovieOpen, setAddMovieOpen] = useState(false)
  const [newMovieHebrew, setNewMovieHebrew] = useState('')
  const [newMovieEnglish, setNewMovieEnglish] = useState('')
  const [newMovieCode, setNewMovieCode] = useState('')
  const [newMovieStudio, setNewMovieStudio] = useState(DEFAULT_STUDIO_OPTIONS[0])
  const [addMovieBusy, setAddMovieBusy] = useState(false)
  const [addMovieError, setAddMovieError] = useState(null)

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))

  const refreshMovies = useCallback(async () => {
    try {
      const [moviesRes, budgetsRes, actualsRes] = await Promise.all([
        supabase
          .from('movies')
          .select('id, movie_name_en, movie_name_he, movie_code, studio_name, release_date')
          .order('movie_name_en'),
        supabase.from('budgets').select('movie_id, budgeted_amount'),
        supabase.from('actual_expenses').select('movie_id, amount'),
      ])

      if (moviesRes.error) throw moviesRes.error
      if (budgetsRes.error) throw budgetsRes.error
      if (actualsRes.error) throw actualsRes.error

      const totals = {}
      for (const row of budgetsRes.data ?? []) {
        const movieUuid = row.movie_id
        const amount = Number(row.budgeted_amount) || 0
        totals[movieUuid] = (totals[movieUuid] ?? 0) + amount
      }
      const actualTotals = {}
      for (const row of actualsRes.data ?? []) {
        const movieUuid = row.movie_id
        const amount = Number(row.amount) || 0
        actualTotals[movieUuid] = (actualTotals[movieUuid] ?? 0) + amount
      }

      setLoadError(null)
      setMovies(moviesRes.data ?? [])
      setMovieBudgetTotals(totals)
      setMovieActualTotals(actualTotals)
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
      setCategoryAmountDrafts({})
      setBudgetError(null)
      return
    }

    let cancelled = false

    async function load() {
      setBudgetLoading(true)
      setBudgetError(null)
      try {
        const rows = await fetchBudgetRows(selectedMovie.id)
        if (!cancelled) setBudgetRows(rows)
      } catch (e) {
        console.error(e)
        if (!cancelled) {
          setBudgetError(e instanceof Error ? e.message : 'Failed to load budget')
          setBudgetRows([])
        }
      } finally {
        if (!cancelled) setBudgetLoading(false)
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [selectedMovie, budgetRefresh])

  useEffect(() => {
    if (budgetLoading) return
    const next = {}
    for (const r of budgetRows) {
      next[r.categoryId] = {
        budget: String(r.budget),
        actual: String(r.actual),
      }
    }
    setCategoryAmountDrafts(next)
  }, [budgetRows, budgetLoading])

  async function saveCategoryRow(categoryId) {
    if (!selectedMovie) return
    const draft = categoryAmountDrafts[categoryId]
    if (!draft) return
    const bRaw = String(draft.budget ?? '')
      .trim()
      .replace(/,/g, '')
    const aRaw = String(draft.actual ?? '')
      .trim()
      .replace(/,/g, '')
    const b = bRaw === '' ? 0 : Number.parseFloat(bRaw)
    const a = aRaw === '' ? 0 : Number.parseFloat(aRaw)
    if (!Number.isFinite(b) || !Number.isFinite(a)) {
      setBudgetError('Enter valid numbers for budget and actual.')
      return
    }
    if (b < 0 || a < 0) {
      setBudgetError('Budget and actual cannot be negative.')
      return
    }

    setSavingCategoryId(categoryId)
    setBudgetError(null)
    try {
      const { error: upsertErr } = await supabase.from('budgets').upsert(
        {
          movie_id: selectedMovie.id,
          category_id: categoryId,
          budgeted_amount: b,
        },
        { onConflict: 'movie_id,category_id' },
      )
      if (upsertErr) throw new Error(upsertErr.message)

      const { error: delErr } = await supabase
        .from('actual_expenses')
        .delete()
        .eq('movie_id', selectedMovie.id)
        .eq('category_id', categoryId)
      if (delErr) throw new Error(delErr.message)

      if (a > 0) {
        const { error: insErr } = await supabase.from('actual_expenses').insert({
          movie_id: selectedMovie.id,
          category_id: categoryId,
          amount: a,
          expense_date: new Date().toISOString().slice(0, 10),
          description: 'Manual entry',
        })
        if (insErr) throw new Error(insErr.message)
      }

      setBudgetRefresh((n) => n + 1)
      await refreshMovies()
    } catch (e) {
      setBudgetError(e instanceof Error ? e.message : String(e))
    } finally {
      setSavingCategoryId(null)
    }
  }

  async function processParsedCsv(results) {
    setUploadFeedback(null)

    if (results.errors?.length) {
      const first = results.errors[0]
      setUploadFeedback({
        type: 'error',
        message: `CSV parse error: ${first.message} (row ${first.row})`,
      })
      return
    }

    const parsedRows = results.data || []
    const firstRow = parsedRows.find((row) =>
      Object.values(row).some((v) => v != null && String(v).trim() !== ''),
    )
    const fields = firstRow
      ? Object.keys(firstRow)
      : (results.meta?.fields || []).map(normalizeCsvHeader)

    const missing = CSV_REQUIRED_HEADERS.filter((h) => !fields.includes(h))
    if (missing.length > 0) {
      setUploadFeedback({
        type: 'error',
        message: `Missing required columns: ${missing.join(', ')}. Expected: ${CSV_REQUIRED_HEADERS.join(', ')}, and optionally description.`,
      })
      return
    }

    const dataRows = parsedRows.filter((row) =>
      Object.values(row).some((v) => v != null && String(v).trim() !== ''),
    )

    if (dataRows.length === 0) {
      setUploadFeedback({ type: 'error', message: 'No data rows found in the CSV.' })
      return
    }

    setUploadBusy(true)
    try {
      const { movieByCode, categoryByNameLower } = await fetchLookupMaps()
      const { errors, inserts, movieNamePatches } = validateRowsToInserts(
        dataRows,
        movieByCode,
        categoryByNameLower,
      )

      if (errors.length > 0) {
        setUploadFeedback({
          type: 'error',
          message: errors.slice(0, 25),
          extra: errors.length > 25 ? `${errors.length - 25} more…` : null,
        })
        return
      }

      await insertActualExpensesInChunks(inserts)

      for (const [movieUuid, patch] of movieNamePatches) {
        const { error: patchErr } = await supabase.from('movies').update(patch).eq('id', movieUuid)
        if (patchErr) throw new Error(patchErr.message)
      }

      setUploadFeedback({
        type: 'success',
        message: `Successfully uploaded ${inserts.length} expense row${inserts.length === 1 ? '' : 's'}.${movieNamePatches.size > 0 ? ` Updated names for ${movieNamePatches.size} title${movieNamePatches.size === 1 ? '' : 's'} from CSV.` : ''}`,
      })
      setBudgetRefresh((n) => n + 1)
    } catch (e) {
      console.error(e)
      setUploadFeedback({
        type: 'error',
        message: e instanceof Error ? e.message : 'Upload failed',
      })
    } finally {
      setUploadBusy(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  function runPapaParse(file) {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: 'greedy',
      transformHeader: normalizeCsvHeader,
      complete: (results) => {
        void processParsedCsv(results)
      },
      error: (err) => {
        setUploadFeedback({ type: 'error', message: err.message || 'Failed to read CSV' })
        setUploadBusy(false)
        if (fileInputRef.current) fileInputRef.current.value = ''
      },
    })
  }

  function handleExpenseCsvChange(event) {
    const file = event.target.files?.[0]
    if (!file) return
    runPapaParse(file)
  }

  function handleDragEnd(event) {
    const { active, over } = event
    if (!over || active.id === over.id) return

    setMovies((current) => {
      if (!Array.isArray(current)) return current
      const oldIndex = current.findIndex((m) => m.id === active.id)
      const newIndex = current.findIndex((m) => m.id === over.id)
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
        const s = m.studio_name?.trim()
        if (s && !merged.includes(s)) merged.push(s)
      }
    }
    merged.sort((a, b) => a.localeCompare(b))
    return merged
  }, [movies])

  const filteredMovies = useMemo(() => {
    if (!Array.isArray(movies)) return []
    const needle = searchTerm.trim().toLowerCase()
    let base =
      needle === ''
        ? [...movies]
        : movies.filter((m) => {
            const nameEn = String(m.movie_name_en ?? '').toLowerCase()
            const nameHe = String(m.movie_name_he ?? '').toLowerCase()
            const prodCode = String(m.movie_code ?? '').toLowerCase()
            const studio = String(m.studio_name ?? '').toLowerCase()
            return (
              nameEn.includes(needle) ||
              nameHe.includes(needle) ||
              prodCode.includes(needle) ||
              studio.includes(needle)
            )
          })

    if (studioFilter !== '') {
      base = base.filter((m) => String(m.studio_name ?? '').trim() === studioFilter)
    }

    if (progressSort === 'none') return base

    const ratioFor = (movie) => {
      const budget = Number(movieBudgetTotals[movie.id] ?? 0)
      const spent = Number(movieActualTotals[movie.id] ?? 0)
      if (budget <= 0) return spent > 0 ? 1 : 0
      return spent / budget
    }

    base.sort((a, b) => {
      const ra = ratioFor(a)
      const rb = ratioFor(b)
      return progressSort === 'desc' ? rb - ra : ra - rb
    })
    return base
  }, [
    movies,
    searchTerm,
    studioFilter,
    progressSort,
    movieBudgetTotals,
    movieActualTotals,
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
    const he = newMovieHebrew.trim()
    const en = newMovieEnglish.trim()
    const code = newMovieCode.trim()
    if (!he && !en) {
      setAddMovieError('Enter at least a Hebrew or English title.')
      return
    }
    if (!code) {
      setAddMovieError('Movie code is required.')
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
        movie_name_en: en,
        movie_name_he: he || null,
        movie_code: code,
        studio_name: studio,
        release_date: null,
      }
      const { data, error } = await supabase.from('movies').insert(payload).select().single()
      if (error) throw error
      await refreshMovies()
      setSelectedMovie(data)
      setAddMovieOpen(false)
      setNewMovieHebrew('')
      setNewMovieEnglish('')
      setNewMovieCode('')
      setNewMovieStudio(DEFAULT_STUDIO_OPTIONS[0])
    } catch (err) {
      setAddMovieError(err instanceof Error ? err.message : String(err))
    } finally {
      setAddMovieBusy(false)
    }
  }

  return (
    <div className="min-h-dvh w-full">
      <main className="w-full overflow-x-hidden pb-[env(safe-area-inset-bottom)]">
        <div className="mx-auto w-full max-w-7xl px-[clamp(1rem,3.5vw,2.5rem)] pb-[clamp(2rem,6vh,4rem)] pt-[clamp(2.25rem,7vh,5rem)]">
            <header className="mb-[clamp(2.25rem,5.5vh,3.75rem)] border-b border-[rgba(123,82,171,0.22)] pb-[clamp(1.75rem,4.5vh,3rem)]">
              <div className="flex min-w-0 items-start gap-3 sm:gap-4">
                <img
                  src={tulipLogo}
                  alt="Tulip Entertainment logo"
                  className="h-10 w-10 shrink-0 rounded-md object-contain sm:h-12 sm:w-12"
                />
                <div className="min-w-0 flex-1">
                  <p className="flex min-w-0 flex-wrap items-baseline gap-x-2.5 gap-y-1">
                    <span className="font-['Montserrat',sans-serif] text-xl font-extrabold tracking-[0.06em] text-[#4B4594] sm:text-2xl">
                      TULIP
                    </span>
                    <span className="font-['Montserrat',sans-serif] text-xl font-[700] uppercase tracking-[0.08em] text-[#F9B233] sm:text-2xl sm:tracking-[0.1em]">
                      Flow
                    </span>
                  </p>
                  <p className="mt-1.5 max-w-prose text-[0.52rem] font-medium uppercase leading-snug tracking-[0.2em] text-[#4B4594]/70 sm:text-[0.55rem] sm:tracking-[0.24em]">
                    Production finance
                  </p>
                </div>
              </div>
            </header>

          {movies === null && (
            <div className="rounded-2xl border border-[rgba(74,20,140,0.15)] bg-white/96 p-16 text-center shadow-[0_18px_45px_rgba(74,20,140,0.1)] backdrop-blur-sm">
              <p className="text-[#6A5B88]">Loading titles…</p>
            </div>
          )}

          {loadError && (
            <div
              className="rounded-xl border border-red-500/30 bg-red-950/20 px-5 py-4 text-sm text-red-100 backdrop-blur-md"
              role="alert"
            >
              {loadError}
            </div>
          )}

          {movies !== null && !loadError && (
            <>
              <div className="grid min-w-0 grid-cols-1 items-start gap-[clamp(1.5rem,3vw,3rem)] lg:grid-cols-[minmax(300px,min(40%,34rem))_minmax(0,1fr)] xl:gap-x-[clamp(2rem,4vw,4rem)]">
              <section className="min-w-0" aria-label="Movies">
                <div
                  className={`rounded-2xl ${brandBorder} bg-white/88 p-4 shadow-[0_24px_55px_rgba(74,20,140,0.12)] backdrop-blur-md lg:sticky lg:top-[max(0.75rem,env(safe-area-inset-top))] lg:h-[min(calc(100dvh_-_1.5rem),calc(100dvh_-_env(safe-area-inset-top)_-_env(safe-area-inset-bottom)_-_1rem))]`}
                >
                  <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                    <h2 className="text-[0.65rem] font-semibold uppercase tracking-[0.22em] text-[#4A148C]">
                      Movies
                    </h2>
                    <div className="flex flex-wrap items-center justify-end gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          setProgressSort((s) =>
                            s === 'none' ? 'desc' : s === 'desc' ? 'asc' : 'none',
                          )
                        }
                        className="inline-flex items-center gap-1.5 rounded-xl border border-[rgba(74,20,140,0.2)] bg-white/95 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-[#4A148C] shadow-[0_8px_16px_rgba(74,20,140,0.12)] transition hover:bg-[#F7F2FF]"
                        title="Sort by budget progress"
                      >
                        <ArrowUpDown className="h-3 w-3" aria-hidden />
                        {progressSort === 'none'
                          ? 'Sort'
                          : progressSort === 'desc'
                            ? 'High %'
                            : 'Low %'}
                      </button>
                      <div className="flex flex-wrap items-center justify-end gap-2">
                        <div className="group relative z-40">
                          <button
                            type="button"
                            disabled={uploadBusy}
                            onClick={() => fileInputRef.current?.click()}
                            className="inline-flex items-center gap-1.5 rounded-xl bg-[#F9B233] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#4B4594] shadow-[0_10px_22px_rgba(249,178,51,0.35)] transition hover:bg-[#fbc050] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#4B4594]/50 disabled:opacity-60"
                            aria-describedby="csv-format-tooltip"
                            title="Hover or focus to see CSV column format"
                          >
                            <Upload className="h-3 w-3" aria-hidden />
                            CSV
                          </button>
                          <div
                            id="csv-format-tooltip"
                            role="tooltip"
                            className="pointer-events-none absolute right-0 top-full z-[100] mt-2 w-[min(19rem,calc(100vw-2rem))] rounded-xl border border-[rgba(74,20,140,0.16)] bg-white p-3 text-left text-[11px] leading-snug text-[#5B4B7A] opacity-0 shadow-[0_22px_48px_rgba(74,20,140,0.18)] ring-1 ring-[rgba(74,20,140,0.06)] transition duration-200 ease-out group-hover:opacity-100 group-focus-within:opacity-100"
                          >
                            <p className="text-[0.65rem] font-semibold uppercase tracking-[0.16em] text-[#4A148C]">
                              Expense CSV
                            </p>
                            <p className="mt-2 text-[10px] leading-relaxed text-[#7C6D98]">
                              Required header row (comma-separated):
                            </p>
                            <pre className="mt-1.5 max-h-24 overflow-x-auto overflow-y-auto whitespace-pre-wrap break-all rounded-lg bg-[#F7F4FC] px-2.5 py-2 font-['JetBrains_Mono',ui-monospace,monospace] text-[10px] leading-relaxed text-[#4B4594]">
                              movie_code,category_name,amount,date,description
                            </pre>
                            <p className="mt-2 text-[10px] text-[#7C6D98]">Example data row:</p>
                            <pre className="mt-1 max-h-20 overflow-x-auto rounded-lg bg-[#FFFBF0] px-2.5 py-2 font-['JetBrains_Mono',ui-monospace,monospace] text-[10px] text-[#5B4B7A]">
                              WB001,TV,1500,2026-04-01,April spend
                            </pre>
                            <div className="mt-3 border-t border-[rgba(74,20,140,0.1)] pt-3">
                              <p className="text-[0.6rem] font-semibold uppercase tracking-[0.12em] text-[#8A7BAB]">
                                Optional (per row)
                              </p>
                              <p className="mt-1.5 text-[10px] leading-relaxed text-[#7C6D98]">
                                Updates display names for that movie when present:
                              </p>
                              <p className="mt-1 font-['JetBrains_Mono',ui-monospace,monospace] text-[10px] text-[#4B4594]">
                                movie_name_en, movie_name_he
                              </p>
                            </div>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            setAddMovieError(null)
                            setAddMovieOpen(true)
                          }}
                          className="inline-flex items-center gap-1.5 rounded-xl border border-[rgba(74,20,140,0.28)] bg-[#4B4594] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-white shadow-[0_8px_18px_rgba(75,69,148,0.35)] transition hover:bg-[#5a529f]"
                        >
                          <Plus className="h-3 w-3" aria-hidden />
                          Add new movie
                        </button>
                      </div>
                    </div>
                  </div>

                  <input
                    id="expense-csv-input"
                    ref={fileInputRef}
                    type="file"
                    accept=".csv,text/csv"
                    className="sr-only"
                    onChange={handleExpenseCsvChange}
                    disabled={uploadBusy}
                    aria-label="CSV file for expense upload"
                  />

                  <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-stretch sm:gap-3">
                    <div
                      className={`flex min-h-[2.5rem] flex-1 items-center gap-2 rounded-xl ${brandBorder} bg-white/95 px-3 py-2 shadow-[0_6px_14px_rgba(74,20,140,0.08)]`}
                    >
                      <Search className="h-4 w-4 shrink-0 text-[#4A148C]" aria-hidden />
                      <input
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        placeholder="Search name, movie code, or studio…"
                        className="w-full min-w-0 bg-transparent text-sm text-[#5B4B7A] outline-none placeholder:text-[#9A8AB8]"
                      />
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

                  {uploadFeedback && (
                    <div
                      className={`mb-3 rounded-md border px-3 py-2 text-xs ${
                        uploadFeedback.type === 'success'
                          ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200'
                          : 'border-red-500/35 bg-red-500/10 text-red-100'
                      }`}
                      role={uploadFeedback.type === 'error' ? 'alert' : 'status'}
                    >
                      {typeof uploadFeedback.message === 'string'
                        ? uploadFeedback.message
                        : `Upload has ${uploadFeedback.message.length} validation issue(s).`}
                    </div>
                  )}

                  {filteredMovies.length === 0 ? (
                    <p className="py-6 text-center text-sm text-[#4A148C]">
                      {movies.length === 0
                        ? 'No movies yet. Use “Add new movie” to create a title.'
                        : 'No movies match your search or studio filter.'}
                    </p>
                  ) : (
                    <div className="movie-list-scroll lg:h-[calc(100%-6.5rem)] lg:overflow-y-auto lg:pr-1">
                      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                        <SortableContext
                          items={filteredMovies.map((m) => m.id)}
                          strategy={verticalListSortingStrategy}
                        >
                          <ul className="grid gap-2.5">
                            {filteredMovies.map((m) => (
                              <li key={m.id}>
                                <SortableMovieCard
                                  movie={m}
                                  totalBudget={movieBudgetTotals[m.id] ?? 0}
                                  actualSpent={movieActualTotals[m.id] ?? 0}
                                  isSelected={selectedMovie?.id === m.id}
                                  onSelect={() =>
                                    setSelectedMovie(selectedMovie?.id === m.id ? null : m)
                                  }
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
                          className="mt-2 max-w-prose break-words text-sm leading-snug text-[#9A8AB8]"
                          dir="rtl"
                          lang="he"
                        >
                          {movieTitleHebrewSubtitle(selectedMovie)}
                        </p>
                      ) : null}
                      <p className="mt-2 break-words text-sm font-medium text-[#6A5B88]">
                        {movieStudioAndCodeLabel(selectedMovie)}
                      </p>
                      {!budgetLoading && !budgetError && budgetRows.length > 0 && (
                        <KpiSummaryCards
                          totalBudget={budgetRows.reduce((sum, row) => sum + row.budget, 0)}
                          totalActual={budgetRows.reduce((sum, row) => sum + row.actual, 0)}
                          scopeLabel="All categories"
                        />
                      )}
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
                          No expense categories found. Add rows to the{' '}
                          <code className="rounded border border-[rgba(74,20,140,0.2)] bg-[#F7F2FF] px-1.5 py-0.5 font-['JetBrains_Mono',ui-monospace,monospace] text-xs text-[#4A148C]">
                            expense_categories
                          </code>{' '}
                          table in Supabase.
                        </p>
                      )}

                      {!budgetLoading && !budgetError && budgetRows.length > 0 && (
                        <>
                          <div className="overflow-x-auto overflow-y-visible rounded-xl border border-[rgba(74,20,140,0.14)] bg-white [-webkit-overflow-scrolling:touch]">
                            <table className="w-full min-w-[22rem] border-collapse text-sm sm:min-w-[36rem]">
                              <thead>
                                <tr className="border-b border-[rgba(74,20,140,0.14)] bg-[#F7F2FF]">
                                  <th
                                    scope="col"
                                    className="align-middle px-3 py-3 text-left text-[0.65rem] font-semibold uppercase tracking-[0.15em] text-[#4A148C] sm:px-4"
                                  >
                                    Category
                                  </th>
                                  <th
                                    scope="col"
                                    className="align-middle px-2 py-3 text-right text-[0.65rem] font-semibold uppercase tracking-[0.15em] text-[#4A148C] sm:px-4"
                                  >
                                    Budget ($)
                                  </th>
                                  <th
                                    scope="col"
                                    className="align-middle px-2 py-3 text-right text-[0.65rem] font-semibold uppercase tracking-[0.15em] text-[#4A148C] sm:px-4"
                                  >
                                    Actual ($)
                                  </th>
                                  <th
                                    scope="col"
                                    className="hidden align-middle px-2 py-3 text-right text-[0.65rem] font-semibold uppercase tracking-[0.15em] text-[#4A148C] sm:table-cell sm:px-4"
                                  >
                                    Variance
                                  </th>
                                  <th
                                    scope="col"
                                    className="align-middle px-2 py-3 text-right text-[0.65rem] font-semibold uppercase tracking-[0.15em] text-[#4A148C] sm:px-4"
                                  >
                                    Save
                                  </th>
                                </tr>
                              </thead>
                              <tbody>
                                {budgetRows.map((row) => {
                                  const d = categoryAmountDrafts[row.categoryId] ?? {
                                    budget: String(row.budget),
                                    actual: String(row.actual),
                                  }
                                  const bNum =
                                    parseFloat(String(d.budget ?? '').replace(/,/g, '')) || 0
                                  const aNum =
                                    parseFloat(String(d.actual ?? '').replace(/,/g, '')) || 0
                                  const varDraft = bNum - aNum
                                  return (
                                    <tr
                                      key={row.categoryId}
                                      className="border-b border-[rgba(123,82,171,0.12)] last:border-0 hover:bg-[#FDF4FA]"
                                    >
                                      <td className="max-w-[11rem] align-middle px-3 py-3 font-medium text-[#5B4B7A] sm:max-w-xs sm:px-4">
                                        <span className="inline-flex min-h-[2.25rem] items-center gap-2">
                                          <span className="h-2 w-2 shrink-0 rounded-full bg-gradient-to-r from-[#7B52AB] via-[#E61E6E] to-[#F9B233]" />
                                          <span className="min-w-0 truncate leading-snug">{row.categoryName}</span>
                                        </span>
                                      </td>
                                      <td className="align-middle px-2 py-3 sm:px-4">
                                        <input
                                          type="number"
                                          min={0}
                                          step={0.01}
                                          inputMode="decimal"
                                          value={d.budget}
                                          onChange={(e) =>
                                            setCategoryAmountDrafts((prev) => ({
                                              ...prev,
                                              [row.categoryId]: {
                                                budget: e.target.value,
                                                actual:
                                                  prev[row.categoryId]?.actual ?? String(row.actual),
                                              },
                                            }))
                                          }
                                          className="h-9 w-full min-w-[5rem] rounded-lg border border-[rgba(74,20,140,0.22)] bg-white px-2 py-0 text-right font-['JetBrains_Mono',ui-monospace,monospace] text-xs tabular-nums text-[#4A148C] outline-none focus:border-[#4B4594] focus:ring-2 focus:ring-[#4B4594]/20 sm:h-10 sm:text-sm"
                                          aria-label={`Budget for ${row.categoryName}`}
                                        />
                                      </td>
                                      <td className="align-middle px-2 py-3 sm:px-4">
                                        <input
                                          type="number"
                                          min={0}
                                          step={0.01}
                                          inputMode="decimal"
                                          value={d.actual}
                                          onChange={(e) =>
                                            setCategoryAmountDrafts((prev) => ({
                                              ...prev,
                                              [row.categoryId]: {
                                                budget:
                                                  prev[row.categoryId]?.budget ?? String(row.budget),
                                                actual: e.target.value,
                                              },
                                            }))
                                          }
                                          className="h-9 w-full min-w-[5rem] rounded-lg border border-[rgba(74,20,140,0.22)] bg-white px-2 py-0 text-right font-['JetBrains_Mono',ui-monospace,monospace] text-xs tabular-nums text-[#4A148C] outline-none focus:border-[#4B4594] focus:ring-2 focus:ring-[#4B4594]/20 sm:h-10 sm:text-sm"
                                          aria-label={`Actual spend for ${row.categoryName}`}
                                        />
                                      </td>
                                      <td
                                        className={`hidden align-middle px-2 py-3 text-right text-sm tabular-nums font-semibold sm:table-cell sm:px-4 ${varianceCellClass(varDraft)}`}
                                      >
                                        {formatCurrency(varDraft)}
                                      </td>
                                      <td className="align-middle px-2 py-3 sm:px-4">
                                        <button
                                          type="button"
                                          onClick={() => saveCategoryRow(row.categoryId)}
                                          disabled={savingCategoryId === row.categoryId}
                                          className="inline-flex h-9 min-w-[3.75rem] items-center justify-center gap-1 rounded-lg bg-[#F9B233] px-2.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-[#4B4594] shadow-sm transition hover:bg-[#fbc050] disabled:opacity-60 sm:h-10 sm:text-[11px]"
                                        >
                                          {savingCategoryId === row.categoryId ? (
                                            <>
                                              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                                              <span className="sr-only">Saving</span>
                                            </>
                                          ) : (
                                            'Save'
                                          )}
                                        </button>
                                      </td>
                                    </tr>
                                  )
                                })}
                              </tbody>
                            </table>
                          </div>
                        </>
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

            <form onSubmit={handleAddMovieSubmit} className="space-y-4">
              <div>
                <label htmlFor="movie-name-he" className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.14em] text-[#4A148C]">
                  Movie name (Hebrew)
                </label>
                <input
                  id="movie-name-he"
                  type="text"
                  dir="rtl"
                  lang="he"
                  value={newMovieHebrew}
                  onChange={(e) => setNewMovieHebrew(e.target.value)}
                  autoComplete="off"
                  className="w-full rounded-xl border border-[rgba(74,20,140,0.2)] bg-white px-3 py-2.5 text-sm text-[#4A148C] outline-none ring-[#4B4594]/0 transition focus:border-[#4B4594] focus:ring-2 focus:ring-[#4B4594]/25"
                  placeholder="שם הסרט"
                />
              </div>
              <div>
                <label htmlFor="movie-name-en" className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.14em] text-[#4A148C]">
                  Movie name (English)
                </label>
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
              <div>
                <label htmlFor="movie-code" className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.14em] text-[#4A148C]">
                  Movie code
                </label>
                <input
                  id="movie-code"
                  type="text"
                  value={newMovieCode}
                  onChange={(e) => setNewMovieCode(e.target.value)}
                  autoComplete="off"
                  className="w-full rounded-xl border border-[rgba(74,20,140,0.2)] bg-white px-3 py-2.5 font-['JetBrains_Mono',ui-monospace,monospace] text-sm text-[#4A148C] outline-none transition focus:border-[#4B4594] focus:ring-2 focus:ring-[#4B4594]/25"
                  placeholder="Production movie_code (CSV movie_code column)"
                />
              </div>
              <div>
                <label htmlFor="movie-studio" className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.14em] text-[#4A148C]">
                  Studio name
                </label>
                <select
                  id="movie-studio"
                  value={studioOptions.includes(newMovieStudio) ? newMovieStudio : studioOptions[0] ?? ''}
                  onChange={(e) => setNewMovieStudio(e.target.value)}
                  className="w-full rounded-xl border border-[rgba(74,20,140,0.2)] bg-white px-3 py-2.5 text-sm text-[#4A148C] outline-none transition focus:border-[#4B4594] focus:ring-2 focus:ring-[#4B4594]/25"
                >
                  {studioOptions.map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                </select>
              </div>

              {addMovieError && (
                <p className="rounded-lg border border-red-500/35 bg-red-500/10 px-3 py-2 text-sm text-red-800" role="alert">
                  {addMovieError}
                </p>
              )}

              <p className="text-[11px] leading-relaxed text-[#8A7BAB]">
                English is shown first; when both languages are set, Hebrew appears below in smaller type.
              </p>

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
