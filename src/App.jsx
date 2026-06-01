import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertCircle, AlertTriangle, ArrowLeft, ArrowUpDown, BookOpen, Calendar, CheckCircle2,
  ChevronDown, Clapperboard, Clock, DollarSign, Download, Edit2,
  Film, Hash, History, LayoutGrid, List, ListChecks, Loader2, LogOut, Plus, PlusCircle,
  Receipt, RefreshCw, Save, Search, Settings, TrendingUp, Trash2 as Trash2Icon,
  UploadCloud, X, XCircle,
} from 'lucide-react'
import * as XLSX from 'xlsx-js-style'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts'
import { supabase } from './lib/supabaseClient'
import tulipLogo from './assets/tulip-logo.png'
import { ExcelUploadButton } from './ExcelUpload'
import { FilmsManagementModal } from './FilmsManagement'
import { CatalogsManagementModal } from './CatalogsManagement'
import UploadsManagementModal from './UploadsManagement'
import BudgetUploadsManagementModal from './BudgetUploadsManagement'
import { LoginPage } from './LoginPage'
import { ResetPasswordPage } from './ResetPasswordPage'
import { isPasswordRecoveryFromUrl, isResetPasswordRoute, clearRecoverySessionFlag, acknowledgePasswordRecovery } from './lib/authRecovery'
import SettingsPage from './SettingsPage'
import MFAComponent from './MFAComponent'

/** @typedef {import('./types/movie').Movie} Movie */

/** Fixed studio name options — shared across the app */
const DEFAULT_STUDIO_OPTIONS = ['Universal', 'Paramount', 'Warner Bros.', 'Independent']

/** Inline film metadata inputs — matches FilmsManagement styling */
function FilmTableInput({ value, onChange, placeholder, className = '', dir, type = 'text' }) {
  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      dir={dir}
      onClick={(e) => e.stopPropagation()}
      className={`w-full rounded-lg border border-[rgba(74,20,140,0.2)] bg-white px-2.5 py-1.5 text-sm text-[#4B4594] outline-none transition focus:border-[#4B4594] focus:ring-2 focus:ring-[#4B4594]/20 ${className}`}
    />
  )
}

function FilmTableSelect({ value, onChange, options, className = '', dir = 'ltr' }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      dir={dir}
      onClick={(e) => e.stopPropagation()}
      className={`w-full rounded-lg border border-[rgba(74,20,140,0.2)] bg-white px-2.5 py-1.5 text-sm text-[#4B4594] outline-none transition focus:border-[#4B4594] focus:ring-2 focus:ring-[#4B4594]/20 ${className}`}
    >
      {options.map(({ value: v, label }) => (
        <option key={v} value={v}>{label}</option>
      ))}
    </select>
  )
}

const ACTIVE_TABLE_BUDGET_ADJ = 'TULIP Active Films adjustment'
const ACTIVE_TABLE_EXP_ADPUB_ADJ = 'TULIP-ADPUB-ADJ'
const ACTIVE_TABLE_EXP_PRINT_ADJ = '950-TULIP-PRINT-ADJ'
const ACTIVE_TABLE_REV_ADJ = 'TULIP-REV-ADJ'

/** Workflow statuses — only these may be changed from the Active Films table */
const ACTIVE_FILMS_WORKFLOW_STATUS_OPTIONS = [
  { value: 'plan_pre',       label: 'Plan Pre' },
  { value: 'screening_post', label: 'Post' },
  { value: 'final',          label: 'Final' },
]

const ACTIVE_FILMS_WORKFLOW_STATUSES = ['plan_pre', 'screening_post', 'final']
const ACTIVE_FILMS_PERF_STATUSES = ['approved', 'underspend', 'overspend']

/** Status dropdown is editable only for manual workflow stages (not computed Under/Over/At Budget). */
function isActiveTableStatusEditable(film, perfStatus) {
  if (perfStatus) return false
  const workflow = film.budget_status || 'plan_pre'
  return ACTIVE_FILMS_WORKFLOW_STATUSES.includes(workflow)
}

function parseActiveTableAmount(val) {
  if (val == null || val === '') return 0
  const n = Number(String(val).replace(/[₪,\s]/g, ''))
  return Number.isFinite(n) ? Math.max(0, n) : 0
}

function tuneFinancialsForPerfStatus(status, planned, adpub) {
  const p = Math.max(0, planned)
  let a = Math.max(0, adpub)
  if (status === 'overspend') {
    a = p > 0 ? Math.max(a, p + 1) : Math.max(a, 1)
  } else if (status === 'underspend') {
    if (p > 0) a = Math.min(a > 0 ? a : p * 0.5, p * 0.94)
    else if (a <= 0) a = 0
  } else if (status === 'approved') {
    if (p > 0) {
      const lo = p * 0.96
      a = a > 0 ? Math.min(Math.max(a, lo), p) : lo
    }
  }
  return { planned: p, adpub: a }
}

/** Dashboard Last Actions: Supabase fetch limit = visible row slots (keep in sync). */
const LAST_ACTIONS_FEED_LIMIT = 8

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

/** Parse release_date like {@link formatReleaseDate}; local calendar semantics for YYYY-MM-DD. */
function parseReleaseLocalDate(value) {
  if (value == null || value === '') return null
  const s = String(value).trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const [y, m, day] = s.split('-').map(Number)
    const d = new Date(y, m - 1, day)
    return Number.isNaN(d.getTime()) ? null : d
  }
  let d = new Date(value)
  if (!Number.isNaN(d.getTime())) return d
  const match = String(value).match(/^(\d{1,2})[./](\d{1,2})[./](\d{2,4})$/)
  if (match) {
    let [, day, month, year] = match.map(Number)
    if (year < 100) year += 2000
    d = new Date(year, month - 1, day)
    return Number.isNaN(d.getTime()) ? null : d
  }
  return null
}

function releaseCalendarYear(value) {
  const d = parseReleaseLocalDate(value)
  return d ? d.getFullYear() : null
}

/** Excel serial (1900 date system) for a release_date — used in Active Films export. */
function releaseDateToExcelSerial(value) {
  const d = parseReleaseLocalDate(value)
  if (!d) return null
  const utc = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())
  return (utc - Date.UTC(1899, 11, 30)) / 86400000
}

const EXCEL_NUM_FMT_COMMA_2DP = '#,##0.00'

function applyExcelCellStyle(cell, patch) {
  if (!cell) return
  cell.s = { ...(cell.s || {}), ...patch, font: { ...(cell.s?.font || {}), ...(patch.font || {}) } }
}

function applyExcelBoldToCell(ws, r, c) {
  const ref = XLSX.utils.encode_cell({ r, c })
  applyExcelCellStyle(ws[ref], { font: { bold: true } })
}

function applyExcelBoldToRow(ws, rowIndex, colCount) {
  for (let c = 0; c < colCount; c++) applyExcelBoldToCell(ws, rowIndex, c)
}

function applyExcelBoldToColumn(ws, colIndex, rowStart, rowEnd) {
  for (let r = rowStart; r <= rowEnd; r++) applyExcelBoldToCell(ws, r, colIndex)
}

function applyExcelDateFormatToColumn(ws, colIndex, rowCount) {
  for (let r = 1; r <= rowCount; r++) {
    const ref = XLSX.utils.encode_cell({ r, c: colIndex })
    const cell = ws[ref]
    if (!cell || cell.t !== 'n') continue
    cell.z = 'dd/mm/yyyy'
  }
}

function applyExcelNumberFormatToColumn(ws, colIndex, rowStart, rowEnd, fmt = EXCEL_NUM_FMT_COMMA_2DP) {
  for (let r = rowStart; r <= rowEnd; r++) {
    const ref = XLSX.utils.encode_cell({ r, c: colIndex })
    const cell = ws[ref]
    if (!cell || cell.v == null || cell.v === '') continue
    if (typeof cell.v === 'number') cell.t = 'n'
    cell.z = fmt
    applyExcelCellStyle(cell, { numFmt: fmt })
  }
}

/** Returns a human-readable relative time string, e.g. "5 min ago", "2 hrs ago" */
function timeAgo(isoString) {
  if (!isoString) return ''
  const diff = Math.floor((Date.now() - new Date(isoString).getTime()) / 1000)
  if (diff < 60)   return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)} hr ago`
  if (diff < 172800) return 'yesterday'
  return `${Math.floor(diff / 86400)}d ago`
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
            Total Adpub
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
          {varianceNegative ? 'Over Adpub' : variancePositive ? 'Under Adpub' : 'On Adpub'}
        </p>
      </div>
    </div>
  )
}

/**
 * Fetch budget vs actual figures for a single film, grouped by category text.
 * Queries the new `budgets` and `expenses` tables (both keyed by film_number).
 */
/** Distinct media_budget_code values from the expenses catalog (for Adpub manual entry). */
async function fetchExpenseMediaBudgetCodes() {
  const PAGE = 1000
  let rows = []
  let from = 0
  while (true) {
    const { data, error } = await supabase
      .from('expenses')
      .select('media_budget_code')
      .not('media_budget_code', 'is', null)
      .neq('media_budget_code', '')
      .range(from, from + PAGE - 1)
    if (error) throw error
    const page = data ?? []
    rows = rows.concat(page)
    if (page.length < PAGE) break
    from += PAGE
  }
  return [...new Set(rows.map((r) => String(r.media_budget_code).trim()).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: 'base' }),
  )
}

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

const DASHBOARD_PAGE_SIZE = 1000

function dashboardNormId(v) {
  return String(v ?? '').trim()
}

function dashboardNormStudio(s) {
  return (s === 'Other' ? 'Independent' : (s ?? '').trim())
}

async function fetchSupabaseAllRows(baseQ) {
  let rows = []
  let from = 0
  while (true) {
    const { data, error } = await baseQ.range(from, from + DASHBOARD_PAGE_SIZE - 1)
    if (error) throw error
    const page = data ?? []
    rows = rows.concat(page)
    if (page.length < DASHBOARD_PAGE_SIZE) break
    from += DASHBOARD_PAGE_SIZE
  }
  return rows
}

async function buildDashboardFilmMap() {
  const allFilms = await fetchSupabaseAllRows(
    supabase.from('films').select('film_number, profit_center, title_en, title_he, studio'),
  )
  const filmMap = {}
  for (const f of allFilms) {
    const entry = {
      title: f.title_en || f.title_he || f.film_number,
      studio: dashboardNormStudio(f.studio),
    }
    if (dashboardNormId(f.film_number)) filmMap[dashboardNormId(f.film_number)] = entry
    if (dashboardNormId(f.profit_center)) filmMap[dashboardNormId(f.profit_center)] = entry
  }
  return filmMap
}

let cachedFilmMap = null
let cachedFilmMapAt = 0
const FILM_MAP_TTL_MS = 60_000

async function getDashboardFilmMap() {
  const now = Date.now()
  if (cachedFilmMap && now - cachedFilmMapAt < FILM_MAP_TTL_MS) return cachedFilmMap
  cachedFilmMap = await buildDashboardFilmMap()
  cachedFilmMapAt = now
  return cachedFilmMap
}

/** One film-map + two table scans for all YTD summary KPIs (was 4× film + 4× queries). */
async function loadDashboardSummaryData(studioFilter) {
  const now = new Date()
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`
  const ytdStart = `${now.getFullYear()}-01-01`
  const selectedLc = studioFilter ? dashboardNormStudio(studioFilter).toLowerCase() : null

  const filmMap = await getDashboardFilmMap()
  const [expRows, incRows] = await Promise.all([
    fetchSupabaseAllRows(
      supabase.from('actual_expenses')
        .select('film_number, actual_amount, month_period, priority_code')
        .gte('month_period', ytdStart)
        .lte('month_period', currentMonth),
    ),
    fetchSupabaseAllRows(
      supabase.from('rental_transactions')
        .select('film_number, actual_amount, month_period')
        .gte('month_period', ytdStart)
        .lte('month_period', currentMonth),
    ),
  ])

  const studioFor = (filmNumber) =>
    dashboardNormStudio(filmMap[dashboardNormId(filmNumber)]?.studio ?? 'Unknown')

  const matchesStudio = (studio) => !selectedLc || studio.toLowerCase() === selectedLc

  let currExpenses = 0
  let ytdExpenses = 0
  let currIncome = 0
  let ytdIncome = 0

  for (const r of expRows) {
    if (!matchesStudio(studioFor(r.film_number))) continue
    const amt = Number(r.actual_amount) || 0
    ytdExpenses += amt
    if (r.month_period === currentMonth) currExpenses += amt
  }

  for (const r of incRows) {
    if (!matchesStudio(studioFor(r.film_number))) continue
    const amt = Number(r.actual_amount) || 0
    ytdIncome += amt
    if (r.month_period === currentMonth) currIncome += amt
  }

  return { currExpenses, ytdExpenses, currIncome, ytdIncome }
}

/**
 * Single source of truth for dashboard expense KPI + drill-down (media + print).
 * Sums every actual_expenses row in range — no is_print filter.
 */
async function aggregateDashboardExpenses({ monthStart, monthEnd, monthEq, studioFilter, filmMap: filmMapIn }) {
  const filmMap = filmMapIn ?? await getDashboardFilmMap()
  let q = supabase
    .from('actual_expenses')
    .select('film_number, actual_amount, month_period, priority_code')
  if (monthEq) q = q.eq('month_period', monthEq)
  else if (monthStart && monthEnd) q = q.gte('month_period', monthStart).lte('month_period', monthEnd)

  const rawRows = await fetchSupabaseAllRows(q)
  const selectedLc = studioFilter ? dashboardNormStudio(studioFilter).toLowerCase() : null
  const aggMap = new Map()
  let total = 0

  for (const r of rawRows) {
    const studio = dashboardNormStudio(filmMap[dashboardNormId(r.film_number)]?.studio ?? 'Unknown')
    if (selectedLc && studio.toLowerCase() !== selectedLc) continue
    const amt = Number(r.actual_amount) || 0
    total += amt
    const month = r.month_period?.substring(0, 7) ?? ''
    const key = `${month}||${studio}`
    if (!aggMap.has(key)) aggMap.set(key, { month, studio, amount: 0, rows: 0 })
    const entry = aggMap.get(key)
    entry.amount += amt
    entry.rows++
  }

  const rows = [...aggMap.values()].sort(
    (a, b) => b.month.localeCompare(a.month) || a.studio.localeCompare(b.studio),
  )
  return { total, rows }
}

async function aggregateDashboardIncome({ monthStart, monthEnd, monthEq, studioFilter, filmMap: filmMapIn }) {
  const filmMap = filmMapIn ?? await getDashboardFilmMap()
  let q = supabase.from('rental_transactions').select('film_number, actual_amount, month_period')
  if (monthEq) q = q.eq('month_period', monthEq)
  else if (monthStart && monthEnd) q = q.gte('month_period', monthStart).lte('month_period', monthEnd)

  const rawRows = await fetchSupabaseAllRows(q)
  const selectedLc = studioFilter ? dashboardNormStudio(studioFilter).toLowerCase() : null
  let total = 0
  for (const r of rawRows) {
    const studio = dashboardNormStudio(filmMap[dashboardNormId(r.film_number)]?.studio ?? 'Unknown')
    if (selectedLc && studio.toLowerCase() !== selectedLc) continue
    total += Number(r.actual_amount) || 0
  }
  return total
}

function currentMonthPeriod() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
}

async function syncActiveTableBudgetTotal(filmNumber, targetTotal) {
  const { data: rows, error } = await supabase
    .from('budgets')
    .select('id, planned_amount, budget_item_name')
    .eq('film_number', filmNumber)
  if (error) throw error

  const list = rows ?? []
  const nonAdj = list.filter((r) => r.budget_item_name !== ACTIVE_TABLE_BUDGET_ADJ)
  const adjRow = list.find((r) => r.budget_item_name === ACTIVE_TABLE_BUDGET_ADJ)
  const baseSum = nonAdj.reduce((s, r) => s + (Number(r.planned_amount) || 0), 0)
  const target = Math.max(0, targetTotal)
  const adjAmount = target - baseSum

  if (nonAdj.length === 0) {
    if (adjRow?.id) await supabase.from('budgets').delete().eq('id', adjRow.id)
    if (target <= 0) return
    const { error: insErr } = await supabase.from('budgets').insert({
      film_number: filmNumber,
      budget_item_name: ACTIVE_TABLE_BUDGET_ADJ,
      planned_amount: target,
      is_media: false,
    })
    if (insErr) throw insErr
    return
  }

  if (adjRow) {
    if (adjAmount === 0) {
      const { error: delErr } = await supabase.from('budgets').delete().eq('id', adjRow.id)
      if (delErr) throw delErr
    } else {
      const { error: upErr } = await supabase.from('budgets').update({ planned_amount: adjAmount }).eq('id', adjRow.id)
      if (upErr) throw upErr
    }
  } else if (adjAmount !== 0) {
    const { error: insErr } = await supabase.from('budgets').insert({
      film_number: filmNumber,
      budget_item_name: ACTIVE_TABLE_BUDGET_ADJ,
      planned_amount: adjAmount,
      is_media: false,
    })
    if (insErr) throw insErr
  }
}

async function syncActiveTableExpenseTotal(filmNumber, targetTotal, { print }) {
  const marker = print ? ACTIVE_TABLE_EXP_PRINT_ADJ : ACTIVE_TABLE_EXP_ADPUB_ADJ
  const { data: rows, error } = await supabase
    .from('actual_expenses')
    .select('id, actual_amount, priority_code')
    .eq('film_number', filmNumber)
  if (error) throw error

  const list = rows ?? []
  const nonAdj = list.filter((r) => r.priority_code !== marker)
  const adjRow = list.find((r) => r.priority_code === marker)
  const baseSum = nonAdj
    .filter((r) => (print ? isPrintCode(r.priority_code) : !isPrintCode(r.priority_code)))
    .reduce((s, r) => s + (Number(r.actual_amount) || 0), 0)
  const target = Math.max(0, targetTotal)
  const adjAmount = target - baseSum
  const month = currentMonthPeriod()

  if (baseSum === 0 && !adjRow && target <= 0) return

  if (adjRow) {
    if (adjAmount === 0) {
      const { error: delErr } = await supabase.from('actual_expenses').delete().eq('id', adjRow.id)
      if (delErr) throw delErr
    } else {
      const { error: upErr } = await supabase.from('actual_expenses').update({ actual_amount: adjAmount }).eq('id', adjRow.id)
      if (upErr) throw upErr
    }
  } else if (adjAmount !== 0) {
    const { error: insErr } = await supabase.from('actual_expenses').insert({
      film_number: filmNumber,
      priority_code: marker,
      actual_amount: adjAmount,
      month_period: month,
      is_print: print,
    })
    if (insErr) throw insErr
  }
}

async function syncActiveTableRevenueTotal(filmNumber, targetTotal) {
  const { data: rows, error } = await supabase
    .from('rental_transactions')
    .select('id, actual_amount, priority_code')
    .eq('film_number', filmNumber)
  if (error) throw error

  const list = rows ?? []
  const nonAdj = list.filter((r) => r.priority_code !== ACTIVE_TABLE_REV_ADJ)
  const adjRow = list.find((r) => r.priority_code === ACTIVE_TABLE_REV_ADJ)
  const baseSum = nonAdj.reduce((s, r) => s + (Number(r.actual_amount) || 0), 0)
  const target = Math.max(0, targetTotal)
  const adjAmount = target - baseSum
  const month = currentMonthPeriod()

  if (baseSum === 0 && !adjRow && target <= 0) return

  if (adjRow) {
    if (adjAmount === 0) {
      const { error: delErr } = await supabase.from('rental_transactions').delete().eq('id', adjRow.id)
      if (delErr) throw delErr
    } else {
      const { error: upErr } = await supabase.from('rental_transactions').update({ actual_amount: adjAmount }).eq('id', adjRow.id)
      if (upErr) throw upErr
    }
  } else if (adjAmount !== 0) {
    const { error: insErr } = await supabase.from('rental_transactions').insert({
      film_number: filmNumber,
      priority_code: ACTIVE_TABLE_REV_ADJ,
      actual_amount: adjAmount,
      month_period: month,
    })
    if (insErr) throw insErr
  }
}

async function syncActiveTableFinancials(filmNumber, { planned, revenue, adpub, print }) {
  await Promise.all([
    syncActiveTableBudgetTotal(filmNumber, planned),
    syncActiveTableRevenueTotal(filmNumber, revenue),
    syncActiveTableExpenseTotal(filmNumber, adpub, { print: false }),
    syncActiveTableExpenseTotal(filmNumber, print, { print: true }),
  ])
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

function SortableMovieCard({ movie, totalBudget, actualSpent, revenue, printSpent, latestMonthExpenses, latestMonthIncome, latestMonthLabel, isSelected, onSelect }) {
  const rawRatio     = totalBudget > 0 ? (actualSpent / totalBudget) * 100 : actualSpent > 0 ? 100 : 0
  const barRatio     = Math.min(rawRatio, 100)   // bar width capped at 100%
  const spentRatio   = rawRatio                  // label shows real %, may exceed 100
  const isOverBudget = totalBudget > 0 && actualSpent > totalBudget
  const isAt80       = !isOverBudget && rawRatio > 80

  return (
    <button
      type="button"
      onClick={onSelect}
      className={`group relative w-full rounded-xl border p-3 text-left transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[rgba(75,69,148,0.5)] ${
        isSelected
          ? 'border-[rgba(249,178,51,0.75)] bg-white shadow-[0_0_0_1px_rgba(249,178,51,0.45),0_12px_28px_rgba(249,178,51,0.24)]'
          : 'border-[rgba(123,82,171,0.24)] bg-white hover:border-[rgba(249,178,51,0.6)] hover:bg-[#FFFDF6] hover:shadow-[0_10px_22px_rgba(123,82,171,0.14)]'
      }`}
    >
      {/* Title row */}
      <div className="mb-1.5 flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-start gap-1.5">
            <h3 className="break-words font-['Montserrat',sans-serif] text-[15px] font-bold leading-snug text-[#4A148C]" dir="auto">
              {movieTitleEnglish(movie)}
            </h3>
            {isOverBudget && (
              <span className="shrink-0 self-start rounded-full bg-[#FFE5EC] px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-[#E61E6E] ring-1 ring-[#E61E6E]/30">
                Over Adpub
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
          <div className="mt-1 flex items-center gap-1.5 overflow-hidden">
            {(movie.profit_center || formatReleaseDate(movie.release_date)) && (
              <div className="inline-flex min-w-0 shrink-0 items-center gap-1.5 whitespace-nowrap">
                {movie.profit_center && (
                  <span className="inline-flex items-center gap-1 rounded-md bg-[#EDE8F8] px-1.5 py-0.5 font-['JetBrains_Mono',ui-monospace,monospace] text-[9px] font-semibold text-[#4A148C]">
                    PC {movie.profit_center}
                  </span>
                )}
                {formatReleaseDate(movie.release_date) && (
                  <span className="inline-flex items-center gap-1 rounded-md bg-[#FFF3E0] px-1.5 py-0.5 text-[9px] font-semibold text-[#E65100]">
                    <Calendar className="h-2.5 w-2.5" aria-hidden />
                    {formatReleaseDate(movie.release_date)}
                  </span>
                )}
              </div>
            )}
            {movie.profit_center_2 && (
              <span className="inline-flex items-center gap-1 rounded-md bg-[#EDE8F8] px-1.5 py-0.5 font-['JetBrains_Mono',ui-monospace,monospace] text-[9px] font-semibold text-[#4A148C]">
                PC2 {movie.profit_center_2}
              </span>
            )}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <p className="font-['Montserrat',sans-serif] text-[15px] font-bold tabular-nums text-[#4B4594]">
            {formatCurrency(totalBudget)}
          </p>
          <p className="text-[8px] uppercase tracking-[0.08em] text-[#9A8AB8]">Planned</p>
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
      <div className="mb-1.5 flex items-center justify-between text-[10px] text-[#8A7BAB]">
        <span>Spent <span className="font-semibold tabular-nums text-[#6A5B88]">{formatCurrency(actualSpent)}</span></span>
        <span
          className="font-semibold tabular-nums"
          style={{ color: isOverBudget ? '#C0004C' : isAt80 ? '#D97706' : '#2FA36B' }}
        >
          {spentRatio.toFixed(0)}%
        </span>
      </div>

      {/* Revenue / Print breakdown */}
      <div className="mb-1.5 grid grid-cols-2 gap-1.5">
        <div className="rounded-md border border-[#D8F3E5] bg-[#F7FDF9] px-2 py-1.5">
          <p className="text-[8px] font-semibold uppercase tracking-[0.1em] text-[#2FA36B]">Revenue</p>
          <p className="font-['JetBrains_Mono',ui-monospace,monospace] text-[11px] font-semibold tabular-nums text-[#2FA36B]">
            {formatCurrency(revenue)}
          </p>
        </div>
        <div className="rounded-md border border-[#FFD8E2] bg-[#FFFAFB] px-2 py-1.5">
          <p className="text-[8px] font-semibold uppercase tracking-[0.1em] text-[#BE123C]">Print</p>
          <p className="font-['JetBrains_Mono',ui-monospace,monospace] text-[11px] font-semibold tabular-nums text-[#BE123C]">
            {formatCurrency(printSpent)}
          </p>
        </div>
      </div>

      {/* Monthly snapshot */}
      {latestMonthLabel && (latestMonthExpenses > 0 || latestMonthIncome > 0) && (
        <div className="mt-1 flex items-center gap-2 rounded-md bg-[#F7F4FC] px-2 py-1.5">
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
  const [loading, setLoading]             = useState(true)
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
        const data = await loadDashboardSummaryData(summaryStudio || null)
        if (!cancelled) {
          setSummary({
            currExpenses: data.currExpenses,
            currIncome: data.currIncome,
            ytdExpenses: data.ytdExpenses,
            ytdIncome: data.ytdIncome,
          })
        }
      } catch (err) {
        console.error('[DashboardSummary] load error', err)
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
      const studioFilter = summaryStudio || null

      if (type === 'revenue') {
        const filmMap = await buildDashboardFilmMap()
        const rawRows = await fetchSupabaseAllRows(
          supabase
            .from('rental_transactions')
            .select('film_number, actual_amount, month_period')
            .gte('month_period', ytdStart)
            .lte('month_period', currentMonth),
        )
        const selectedLc = studioFilter ? dashboardNormStudio(studioFilter).toLowerCase() : null
        const aggMap = new Map()
        for (const r of rawRows) {
          const studio = dashboardNormStudio(filmMap[dashboardNormId(r.film_number)]?.studio ?? 'Unknown')
          if (selectedLc && studio.toLowerCase() !== selectedLc) continue
          const month = r.month_period?.substring(0, 7) ?? ''
          const key = `${month}||${studio}`
          if (!aggMap.has(key)) aggMap.set(key, { month, studio, amount: 0, rows: 0 })
          const entry = aggMap.get(key)
          entry.amount += Number(r.actual_amount) || 0
          entry.rows++
        }
        const rows = [...aggMap.values()].sort(
          (a, b) => b.month.localeCompare(a.month) || a.studio.localeCompare(b.studio),
        )
        const total = rows.reduce((s, r) => s + r.amount, 0)
        setDrilldown({ type, rows, total, loading: false, year: currentYear })
      } else {
        const { total, rows } = await aggregateDashboardExpenses({
          monthStart: ytdStart,
          monthEnd: currentMonth,
          studioFilter,
        })
        setDrilldown({ type, rows, total, loading: false, year: currentYear })
        // Keep KPI card in sync with the same aggregation the drill-down uses
        setSummary((prev) => (prev ? { ...prev, ytdExpenses: total } : prev))
      }
    } catch (err) {
      console.error('[Drilldown] error', err)
      setDrilldown(null)
    }
  }

  const cards = [
    { label: 'Revenue YTD',  value: summary?.ytdIncome   ?? 0, color: '#2FA36B', icon: DollarSign, drillType: 'revenue'  },
    { label: 'Expenses YTD', value: summary?.ytdExpenses ?? 0, color: '#7B52AB', icon: Receipt,    drillType: 'expenses' },
  ]

  const currentYear = new Date().getFullYear()

  return (
    <div className="mb-8">
      {/* ── YTD cards + inline studio filter + Audit ── */}
      <div className="rounded-2xl border border-[rgba(74,20,140,0.12)] bg-white p-4 shadow-[0_6px_20px_rgba(74,20,140,0.07)]">

        {/* Top row: label + studio pills + Audit button */}
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <span className="shrink-0 text-[0.6rem] font-bold uppercase tracking-[0.18em] text-[#8A7BAB]">
            YTD {currentYear}
          </span>

          {/* Studio selector */}
          <div className="flex flex-wrap items-center gap-1">
            <button type="button" onClick={() => setSummaryStudio('')}
              className={`rounded-md px-2.5 py-0.5 text-[10px] font-semibold transition-all ${
                summaryStudio === ''
                  ? 'bg-[#4A148C] text-white shadow-sm'
                  : 'border border-[rgba(74,20,140,0.18)] bg-[#F7F4FB] text-[#8A7BAB] hover:bg-[#EDE8F8] hover:text-[#4A148C]'
              }`}>All</button>
            {studioOptions.map((s) => (
              <button key={s} type="button" onClick={() => setSummaryStudio(s)}
                className={`rounded-md px-2.5 py-0.5 text-[10px] font-semibold transition-all ${
                  summaryStudio === s
                    ? 'bg-[#4A148C] text-white shadow-sm'
                    : 'border border-[rgba(74,20,140,0.18)] bg-[#F7F4FB] text-[#8A7BAB] hover:bg-[#EDE8F8] hover:text-[#4A148C]'
                }`}>{s}</button>
            ))}
          </div>

          {/* Audit button — pushed right */}
          <button type="button" onClick={() => showAudit ? setShowAudit(false) : runAudit()}
            className="ml-auto flex items-center gap-1.5 rounded-lg border border-[rgba(74,20,140,0.18)] bg-[#F7F4FB] px-2.5 py-1 text-[10px] font-semibold text-[#8A7BAB] transition hover:bg-[#EDE8F8] hover:text-[#4A148C]"
            title="Audit data consistency">
            <Receipt className="h-3 w-3" aria-hidden />
            {showAudit ? 'Hide Audit' : 'Audit Data'}
          </button>
        </div>

        {/* KPI cards — 2 columns */}
        <div className="grid grid-cols-2 gap-3">
          {cards.map(({ label, value, color, icon: Icon, drillType }) => (
            <div key={label}
              onClick={() => fetchDrilldown(drillType)}
              role="button" tabIndex={0}
              onKeyDown={(e) => e.key === 'Enter' && fetchDrilldown(drillType)}
              title="Click to see breakdown"
              className="cursor-pointer rounded-xl border border-[rgba(74,20,140,0.10)] bg-[#FAFAFE] p-3.5 transition hover:border-[rgba(74,20,140,0.25)] hover:shadow-[0_6px_18px_rgba(74,20,140,0.11)]">
              <div className="mb-2 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <div className="flex h-7 w-7 items-center justify-center rounded-lg" style={{ background: `${color}18` }}>
                    <Icon className="h-3.5 w-3.5" style={{ color }} aria-hidden />
                  </div>
                  <p className="text-[0.6rem] font-semibold uppercase tracking-[0.16em] text-[#8A7BAB]">{label}</p>
                </div>
                <span className="rounded-md border border-[rgba(74,20,140,0.14)] bg-[#F4F0FF] px-1.5 py-0.5 text-[9px] font-semibold text-[#8A7BAB]">
                  Drill ↗
                </span>
              </div>
              {loading ? (
                <div className="mt-1 h-5 w-24 animate-pulse rounded bg-[#EDE8F8]" />
              ) : (
                <>
                  <p className="text-center font-['Montserrat',sans-serif] text-xl font-extrabold tabular-nums" style={{ color }}>
                    {formatCurrency(value)}
                  </p>
                  {label === 'Expenses YTD' && (
                    <p className="mt-1 text-center text-[9px] font-medium text-[#9A8AB8]">Media &amp; print</p>
                  )}
                </>
              )}
            </div>
          ))}
        </div>
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
                      {!isRevenue && ' · Media & print expenses'}
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
  const [session, setSession] = useState(undefined)
  const [mfaStatus, setMfaStatus] = useState('loading')
  const [passwordRecovery, setPasswordRecovery] = useState(
    () => isResetPasswordRoute() || isPasswordRecoveryFromUrl(),
  )
  const [currentPage, setCurrentPage] = useState('dashboard') // 'dashboard' | 'settings'

  const recheckMfa = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setMfaStatus('loading')
    try {
      const { data: { session: currentSession } } = await supabase.auth.getSession()
      if (!currentSession) {
        setMfaStatus('required')
        return false
      }

      const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
      if (error) {
        // Recovery / AAL1 sessions cannot query MFA — do not treat as logged-in dashboard.
        if (/mfa|aal|factor/i.test(error.message ?? '')) {
          setMfaStatus('required')
          return false
        }
        throw error
      }

      const verified = data.currentLevel === 'aal2'
      setMfaStatus(verified ? 'verified' : 'required')
      return verified
    } catch {
      setMfaStatus('required')
      return false
    }
  }, [])

  useEffect(() => {
    if (isResetPasswordRoute()) return

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, s) => {
      if (event === 'PASSWORD_RECOVERY') {
        setPasswordRecovery(true)
        acknowledgePasswordRecovery()
      }
      setSession(s ?? null)
    })

    supabase.auth.getSession().then(({ data: { session: s } }) => setSession(s ?? null))

    return () => subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (isResetPasswordRoute() || isPasswordRecoveryFromUrl()) {
      setPasswordRecovery(true)
    }
  }, [])

  const completePasswordRecovery = useCallback(() => {
    clearRecoverySessionFlag()
    setPasswordRecovery(false)
    setSession(null)
    setMfaStatus('required')
  }, [])

  // Keep URL in sync: login when logged out; dashboard only when MFA verified.
  useEffect(() => {
    if (session === undefined) return
    const path = window.location.pathname
    if (!session) {
      if (path === '/dashboard' || path === '/settings') {
        const search = window.location.search
        window.history.replaceState(null, '', `/${search}`)
      }
      return
    }
    if (mfaStatus === 'verified' && (path === '/' || path === '')) {
      window.history.replaceState(null, '', '/dashboard')
    }
  }, [session, mfaStatus])

  useEffect(() => {
    if (session === undefined) return
    if (!session || passwordRecovery) {
      setMfaStatus('required')
      return
    }
    void recheckMfa()
  }, [session, recheckMfa, passwordRecovery])

  // Re-validate MFA after bfcache restore or tab focus (prevents Back-button bypass).
  useEffect(() => {
    if (!session || passwordRecovery) return

    const onPageShow = () => { void recheckMfa({ silent: true }) }
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void recheckMfa({ silent: true })
    }
    const onPopState = () => {
      window.history.replaceState(null, '', window.location.pathname || '/')
      void recheckMfa({ silent: true })
    }

    window.addEventListener('pageshow', onPageShow)
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('popstate', onPopState)
    return () => {
      window.removeEventListener('pageshow', onPageShow)
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('popstate', onPopState)
    }
  }, [session, recheckMfa, passwordRecovery])
  const [movies, setMovies] = useState(null)
  const [movieBudgetTotals, setMovieBudgetTotals] = useState({})
  const [movieActualTotals, setMovieActualTotals] = useState({})
  const [movieIncomeTotals, setMovieIncomeTotals]     = useState({})
  const [movieMarketingTotals, setMovieMarketingTotals] = useState({})
  const [moviePrintTotals, setMoviePrintTotals]         = useState({})
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
  const [dateFrom, setDateFrom]         = useState('')
  const [dateTo, setDateTo]             = useState('')
  const [datePickerOpen, setDatePickerOpen] = useState(false)
  const datePickerRef = useRef(null)
  const [lastActions, setLastActions]   = useState([])
  const [filmsViewMode, setFilmsViewMode]   = useState('card') // 'card' | 'table'
  const [tableSortCol,  setTableSortCol]    = useState('release_date')
  const [tableSortDir,  setTableSortDir]    = useState('asc')
  const [activeTableEditingId, setActiveTableEditingId] = useState(null)
  const [activeTableDraft, setActiveTableDraft] = useState({})
  const [activeTableSaving, setActiveTableSaving] = useState(false)
  const [activeTableSaveError, setActiveTableSaveError] = useState(null)
  const [activeTableConfirmFnChange, setActiveTableConfirmFnChange] = useState(null)
  const [adminMenuOpen, setAdminMenuOpen] = useState(false)
  const [filmsManagerOpen, setFilmsManagerOpen] = useState(false)
  const [catalogsManagerOpen, setCatalogsManagerOpen] = useState(null) // null | 'expenses' | 'rentals'
  const [uploadsManagerOpen, setUploadsManagerOpen]         = useState(false)
  const [budgetUploadsManagerOpen, setBudgetUploadsManagerOpen] = useState(false)
  const adminMenuRef = useRef(null)
  // Catalog-import gate: 'locked' | 'challenging' | 'unlocked'
  const [catalogImportGate, setCatalogImportGate] = useState('locked')
  const [catalogImportPwInput, setCatalogImportPwInput] = useState('')
  const [catalogImportPwError, setCatalogImportPwError] = useState('')

  // ── Dashboard widgets ──────────────────────────────────────────────────────
  const [lastUpdateInfo, setLastUpdateInfo] = useState(null) // array of { studio, period } | null

  useEffect(() => {
    if (mfaStatus !== 'verified' || !session) return

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
  }, [mfaStatus, session])

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
  const [adpubMediaCodeOptions, setAdpubMediaCodeOptions] = useState([])
  const [adpubMediaCodeOptionsLoading, setAdpubMediaCodeOptionsLoading] = useState(false)
  const [openMediaCodeRowId, setOpenMediaCodeRowId] = useState(null)

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
      const marketingTotals  = {}   // only non-print expenses (for progress bar / AdPub)
      const printTotals      = {}   // only print expenses
      const latestMonthByFilm = {}
      const monthlyExpByFilm  = {}
      for (const row of (actualRes.status === 'fulfilled' ? actualRes.value.data : null) ?? []) {
        if (!row.film_number) continue
        const isPrint = isPrintCode(row.priority_code)
        const amt = Number(row.actual_amount) || 0
        actualTotals[row.film_number] = (actualTotals[row.film_number] ?? 0) + amt
        if (!isPrint) {
          marketingTotals[row.film_number] = (marketingTotals[row.film_number] ?? 0) + amt
        } else {
          printTotals[row.film_number] = (printTotals[row.film_number] ?? 0) + amt
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

      // Fetch ALL films so that newly added films (with just a release date,
      // no financial data yet) are visible in Coming Soon and the Active Films list.
      let filmsData = []
      {
        let from = 0
        const PAGE = 1000
        while (true) {
          const { data: page, error: pageErr } = await supabase
            .from('films').select('*').order('title_en').range(from, from + PAGE - 1)
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
      setMoviePrintTotals(printTotals)
      setMovieIncomeTotals(incomeTotals)
      setMovieLatestMonth(latestMonthByFilm)
      setMovieMonthlyExp(snapExp)
      setMovieMonthlyInc(snapInc)
      cachedFilmMap = null
    } catch (err) {
      console.error(err)
      setLoadError(err instanceof Error ? err.message : String(err))
      setMovies([])
      setMovieBudgetTotals({})
      setMovieActualTotals({})
    }
  }, [])

  useEffect(() => {
    if (mfaStatus !== 'verified' || !session) return
    void refreshMovies()
  }, [mfaStatus, session, refreshMovies])

  const startActiveTableEdit = useCallback((film) => {
    const fn = film.film_number
    const plannedVal = movieBudgetTotals[fn] ?? 0
    const revenueVal = movieIncomeTotals[fn] ?? 0
    const adpubVal = movieMarketingTotals[fn] ?? 0
    const printVal = moviePrintTotals[fn] ?? 0
    const budget = Number(plannedVal)
    const spent = Number(adpubVal)
    let perfStatus = null
    if (budget > 0 && spent > 0) {
      if (spent > budget) perfStatus = 'overspend'
      else if (spent <= budget * 0.95) perfStatus = 'underspend'
      else perfStatus = 'approved'
    }
    const statusEditable = isActiveTableStatusEditable(film, perfStatus)
    setActiveTableEditingId(fn)
    setActiveTableDraft({
      film_number:     film.film_number ?? '',
      title_en:        film.title_en    ?? '',
      title_he:        film.title_he    ?? '',
      profit_center:   film.profit_center   ?? '',
      profit_center_2: film.profit_center_2 ?? '',
      release_date:    film.release_date ? film.release_date.slice(0, 10) : '',
      status:          perfStatus || film.budget_status || 'plan_pre',
      statusEditable,
    })
    setActiveTableSaveError(null)
    setActiveTableConfirmFnChange(null)
  }, [movieBudgetTotals, movieIncomeTotals, movieMarketingTotals, moviePrintTotals])

  const cancelActiveTableEdit = useCallback(() => {
    setActiveTableEditingId(null)
    setActiveTableDraft({})
    setActiveTableSaveError(null)
    setActiveTableConfirmFnChange(null)
  }, [])

  const patchActiveTableDraft = useCallback((key, val) => {
    setActiveTableDraft((d) => ({ ...d, [key]: val }))
  }, [])

  const buildActiveTableSaveBundle = useCallback((draft) => {
    const status = draft.status || 'plan_pre'
    const statusEditable = draft.statusEditable !== false

    const filmPayload = {
      title_en:        draft.title_en     || null,
      title_he:        draft.title_he     || null,
      profit_center:   draft.profit_center   || null,
      profit_center_2: draft.profit_center_2 || null,
      release_date:    draft.release_date    || null,
    }
    if (statusEditable && ACTIVE_FILMS_WORKFLOW_STATUSES.includes(status)) {
      filmPayload.budget_status = status
    }

    return { filmPayload }
  }, [])

  // ── Activity log helpers ───────────────────────────────────────────────────
  const logActivity = useCallback(async (action_type, description, film_title = null, film_number = null) => {
    try {
      await supabase.from('activity_log').insert({ action_type, description, film_title, film_number })
    } catch (err) {
      console.warn('[activityLog] insert failed:', err)
    }
  }, [])

  const fetchLastActions = useCallback(async () => {
    try {
      const { data } = await supabase
        .from('activity_log')
        .select('id, action_type, description, film_title, created_at')
        .order('created_at', { ascending: false })
        .limit(LAST_ACTIONS_FEED_LIMIT)
      setLastActions(data ?? [])
    } catch (err) {
      console.warn('[activityLog] fetch failed:', err)
    }
  }, [])

  const executeActiveTableFilmUpdate = useCallback(async (oldFn, newFn, filmPayload, actionMeta = {}) => {
    setActiveTableSaving(true)
    setActiveTableSaveError(null)
    try {
      if (oldFn !== newFn) {
        await Promise.all([
          supabase.from('actual_expenses').update({ film_number: newFn }).eq('film_number', oldFn),
          supabase.from('rental_transactions').update({ film_number: newFn }).eq('film_number', oldFn),
          supabase.from('budgets').update({ film_number: newFn }).eq('film_number', oldFn),
        ])
        const { error } = await supabase.from('films').update({ ...filmPayload, film_number: newFn }).eq('film_number', oldFn)
        if (error) throw error
      } else {
        const { error } = await supabase.from('films').update(filmPayload).eq('film_number', oldFn)
        if (error) throw error
      }

      setMovies((prev) =>
        (prev ?? []).map((f) =>
          f.film_number === oldFn ? { ...f, ...filmPayload, film_number: newFn } : f,
        ),
      )
      setSelectedMovie((prev) => {
        if (!prev || prev.film_number !== oldFn) return prev
        return { ...prev, ...filmPayload, film_number: newFn }
      })

      const statusLabel = { plan_pre: 'Plan Pre', screening_post: 'Screening Post', final: 'Final' }
      const activityEntries = []
      if (actionMeta.releaseDateChanged) {
        activityEntries.push([
          'release_date_edit',
          `Release date updated: ${actionMeta.prevReleaseDate || '—'} → ${actionMeta.nextReleaseDate || '—'}`,
        ])
      }
      if (actionMeta.profitCenterChanged) {
        activityEntries.push([
          'profit_center_edit',
          `Profit center updated: ${actionMeta.prevProfitCenter || '—'} → ${actionMeta.nextProfitCenter || '—'}`,
        ])
      }
      if (actionMeta.profitCenter2Changed) {
        activityEntries.push([
          'profit_center_edit',
          `Profit center 2 updated: ${actionMeta.prevProfitCenter2 || '—'} → ${actionMeta.nextProfitCenter2 || '—'}`,
        ])
      }
      if (actionMeta.filmNumberChanged) {
        activityEntries.push([
          'film_number_edit',
          `Film number updated: ${actionMeta.oldFn} → ${actionMeta.newFn}`,
        ])
      }
      if (actionMeta.statusChanged) {
        activityEntries.push([
          'status_change',
          `Status updated: ${statusLabel[actionMeta.prevStatus] ?? actionMeta.prevStatus} → ${statusLabel[actionMeta.nextStatus] ?? actionMeta.nextStatus}`,
        ])
      }
      for (const [actionType, description] of activityEntries) {
        await logActivity(actionType, description, actionMeta.filmTitle, newFn)
      }
      if (activityEntries.length > 0) {
        void fetchLastActions()
      }

      setActiveTableDraft({})
      setActiveTableConfirmFnChange(null)
      setActiveTableEditingId(null)
      void refreshMovies()
    } catch (err) {
      setActiveTableSaveError(err.message ?? String(err))
    } finally {
      setActiveTableSaving(false)
    }
  }, [refreshMovies, logActivity, fetchLastActions])

  const handleActiveTableSave = useCallback(async (originalFilm) => {
    setActiveTableSaveError(null)
    const newFn = activeTableDraft.film_number.trim()
    const oldFn = originalFilm.film_number
    if (!newFn) {
      setActiveTableSaveError('Film number cannot be empty.')
      return
    }
    const { filmPayload } = buildActiveTableSaveBundle(activeTableDraft)
    const prevReleaseDate = originalFilm.release_date ? String(originalFilm.release_date).slice(0, 10) : ''
    const nextReleaseDate = activeTableDraft.release_date ? String(activeTableDraft.release_date).slice(0, 10) : ''
    const prevProfitCenter = String(originalFilm.profit_center ?? '').trim()
    const nextProfitCenter = String(activeTableDraft.profit_center ?? '').trim()
    const prevProfitCenter2 = String(originalFilm.profit_center_2 ?? '').trim()
    const nextProfitCenter2 = String(activeTableDraft.profit_center_2 ?? '').trim()
    const prevStatus = originalFilm.budget_status || 'plan_pre'
    const nextStatus = filmPayload.budget_status ?? prevStatus
    const actionMeta = {
      releaseDateChanged: prevReleaseDate !== nextReleaseDate,
      prevReleaseDate: prevReleaseDate || null,
      nextReleaseDate: nextReleaseDate || null,
      profitCenterChanged: prevProfitCenter !== nextProfitCenter,
      prevProfitCenter,
      nextProfitCenter,
      profitCenter2Changed: prevProfitCenter2 !== nextProfitCenter2,
      prevProfitCenter2,
      nextProfitCenter2,
      filmNumberChanged: newFn !== oldFn,
      oldFn,
      newFn,
      statusChanged: filmPayload.budget_status != null && prevStatus !== filmPayload.budget_status,
      prevStatus,
      nextStatus: filmPayload.budget_status,
      filmTitle: originalFilm.title_en || originalFilm.title_he || null,
    }
    if (newFn !== oldFn) {
      setActiveTableConfirmFnChange({ oldFn, newFn, filmPayload, actionMeta })
    } else {
      await executeActiveTableFilmUpdate(oldFn, oldFn, filmPayload, actionMeta)
    }
  }, [activeTableDraft, buildActiveTableSaveBundle, executeActiveTableFilmUpdate])

  useEffect(() => {
    if (mfaStatus !== 'verified' || !session) return
    void fetchLastActions()
  }, [mfaStatus, session, fetchLastActions])

  const startBudgetEditEmpty = useCallback(() => {
    setDraftRows([{
      id:           `new_${Date.now()}`,
      isNew:        true,
      categoryName: '',
      vendorName:   '',
      budget:       0,
      mediaCode:    '',
      isMedia:      false,
    }])
    setBudgetEditMode(true)
    setExpandedGroups(new Set(['__none__']))
  }, [])

  const startBudgetEditFromLoaded = useCallback(() => {
    if (budgetRows.length === 0) {
      startBudgetEditEmpty()
      return
    }
    setDraftRows(budgetRows.map((r) => ({ ...r, isNew: false })))
    setBudgetEditMode(true)
    setExpandedGroups(new Set(budgetRows.map((r) => r.mediaCode || '__none__')))
  }, [budgetRows, startBudgetEditEmpty])

  const cancelBudgetEdit = useCallback(() => {
    setBudgetEditMode(false)
    setDraftRows([])
    setBudgetSaveToast(null)
  }, [])

  useEffect(() => {
    if (!budgetEditMode || budgetRows.length > 0) return
    let cancelled = false
    async function loadMediaCodes() {
      setAdpubMediaCodeOptionsLoading(true)
      try {
        const codes = await fetchExpenseMediaBudgetCodes()
        if (!cancelled) setAdpubMediaCodeOptions(codes)
      } catch (err) {
        console.error('[Adpub] media code catalog load failed:', err)
        if (!cancelled) setAdpubMediaCodeOptions([])
      } finally {
        if (!cancelled) setAdpubMediaCodeOptionsLoading(false)
      }
    }
    void loadMediaCodes()
    return () => { cancelled = true }
  }, [budgetEditMode, budgetRows.length])

  const adpubMediaCodeSearchOptions = useMemo(() => {
    const extra = draftRows.map((r) => r.mediaCode?.trim()).filter(Boolean)
    const codes = [...new Set([...adpubMediaCodeOptions, ...extra])].sort((a, b) =>
      a.localeCompare(b, 'he', { sensitivity: 'base' }),
    )
    return codes
  }, [adpubMediaCodeOptions, adpubMediaCodeOptionsLoading, draftRows])

  const patchBudgetDraftField = useCallback((rowId, field, value) => {
    setDraftRows((prev) =>
      prev.map((r) => (r.id === rowId ? { ...r, [field]: value } : r)),
    )
  }, [])

  const removeBudgetDraftRow = useCallback((rowId) => {
    setDraftRows((prev) => prev.filter((r) => r.id !== rowId))
  }, [])

  const addBudgetDraftRow = useCallback(() => {
    setDraftRows((prev) => [
      ...prev,
      {
        id:           `new_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        isNew:        true,
        categoryName: '',
        vendorName:   '',
        budget:       0,
        mediaCode:    '',
        isMedia:      false,
      },
    ])
    setExpandedGroups((prev) => {
      const next = new Set(prev)
      next.add('__none__')
      return next
    })
  }, [])

  const addBudgetDraftRowWithPrefill = useCallback((prefill = {}) => {
    setDraftRows((prev) => [
      ...prev,
      {
        id:           `new_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        isNew:        true,
        categoryName: prefill.categoryName ?? '',
        vendorName:   prefill.vendorName ?? '',
        budget:       prefill.budget ?? 0,
        mediaCode:    prefill.mediaCode ?? '',
        isMedia:      prefill.isMedia ?? false,
      },
    ])
    setExpandedGroups((prev) => {
      const next = new Set(prev)
      next.add((prefill.mediaCode || '').trim() || '__none__')
      return next
    })
  }, [])

  const saveBudgetEdit = useCallback(async () => {
    const film = selectedMovie
    if (!film?.film_number) return

    const namedRows = draftRows.filter((r) => r.categoryName?.trim())
    if (namedRows.length === 0) {
      setBudgetSaveToast('error')
      setTimeout(() => setBudgetSaveToast(null), 3500)
      return
    }

    setBudgetSaving(true)
    setBudgetSaveToast(null)
    try {
      const draftExistingIds = new Set(
        draftRows.filter((r) => !r.isNew && r.id).map((r) => String(r.id)),
      )
      const deletedRows = (budgetRows ?? []).filter((r) => r.id && !draftExistingIds.has(String(r.id)))
      for (const r of deletedRows) {
        const { error } = await supabase.from('budgets').delete().eq('id', r.id)
        if (error) throw new Error(error.message)
      }

      const existing = draftRows.filter((r) => !r.isNew && r.id)
      for (const r of existing) {
        const { error } = await supabase
          .from('budgets')
          .update({
            budget_item_name:  r.categoryName || '',
            vendor_name:       r.vendorName || null,
            planned_amount:    Number(r.budget) || 0,
            media_budget_code: r.mediaCode || null,
            is_media:          r.isMedia,
          })
          .eq('id', r.id)
        if (error) throw new Error(error.message)
      }

      const newRows = draftRows.filter((r) => r.isNew && r.categoryName?.trim())
      if (newRows.length > 0) {
        const rowsToInsert = newRows.map((r) => ({
          film_number:       film.film_number,
          budget_item_name:  r.categoryName.trim(),
          vendor_name:       r.vendorName || null,
          planned_amount:    Number(r.budget) || 0,
          media_budget_code: r.mediaCode || null,
          is_media:          r.isMedia,
        }))
        const { error } = await supabase.from('budgets').insert(rowsToInsert)
        if (error) throw new Error(error.message)
      }

      setBudgetSaveToast('success')
      setBudgetEditMode(false)
      setDraftRows([])
      setBudgetRefresh((n) => n + 1)
      void logActivity(
        'budget_edit',
        'Adpub updated',
        film.title_en || film.title_he,
        film.film_number,
      )
      void fetchLastActions()
      void refreshMovies()
      setTimeout(() => setBudgetSaveToast(null), 3500)
    } catch (err) {
      console.error('Budget save error:', err)
      setBudgetSaveToast('error')
      setTimeout(() => setBudgetSaveToast(null), 3500)
    } finally {
      setBudgetSaving(false)
    }
  }, [selectedMovie, draftRows, budgetRows, logActivity, fetchLastActions, refreshMovies])

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
      setAdpubMediaCodeOptions([])
      setAdpubMediaCodeOptionsLoading(false)
      setOpenMediaCodeRowId(null)
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
        setBudgetError(budgetResult.reason?.message ?? 'Failed to load Adpub')
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

  useEffect(() => {
    if (!datePickerOpen) return
    function handler(e) {
      if (datePickerRef.current && !datePickerRef.current.contains(e.target)) setDatePickerOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [datePickerOpen])

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
      // Server-side search returns any year (limited columns; enough for list + modal fetch)
      base = [...searchResults]
    } else {
      const yNow = new Date().getFullYear()
      base = all.filter((m) => releaseCalendarYear(m.release_date) === yNow)
      base.sort((a, b) => {
        const ta = parseReleaseLocalDate(a.release_date)?.getTime() ?? Number.POSITIVE_INFINITY
        const tb = parseReleaseLocalDate(b.release_date)?.getTime() ?? Number.POSITIVE_INFINITY
        return ta - tb
      })
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

    if (dateFrom) {
      base = base.filter((m) => m.release_date && m.release_date >= dateFrom)
    }
    if (dateTo) {
      base = base.filter((m) => m.release_date && m.release_date <= dateTo)
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
    dateFrom, dateTo, movieBudgetTotals, movieActualTotals, movieIncomeTotals,
    getFilmPerfStatus,
  ])

  /** Table view row order — matches column sort UI */
  const sortedActiveFilmsTableRows = useMemo(() => {
    const dir = tableSortDir === 'asc' ? 1 : -1
    const getVal = (m) => {
      if (tableSortCol === 'planned') return movieBudgetTotals[m.film_number] ?? 0
      if (tableSortCol === 'revenue') return movieIncomeTotals[m.film_number] ?? 0
      if (tableSortCol === 'adpub') return movieMarketingTotals[m.film_number] ?? 0
      if (tableSortCol === 'print') return moviePrintTotals[m.film_number] ?? 0
      if (tableSortCol === 'budget_status') {
        const perf = getFilmPerfStatus(m)
        if (perf === 'overspend' || perf === 'underspend') return perf
        return (m.budget_status || 'plan_pre').toLowerCase()
      }
      const v = m[tableSortCol] ?? ''
      return typeof v === 'string' ? v.toLowerCase() : v
    }
    return [...filteredMovies].sort((a, b) => {
      const va = getVal(a), vb = getVal(b)
      if (va < vb) return -dir
      if (va > vb) return dir
      return 0
    })
  }, [filteredMovies, tableSortCol, tableSortDir, movieBudgetTotals, movieIncomeTotals, movieMarketingTotals, moviePrintTotals, getFilmPerfStatus])

  const exportActiveFilmsTableToExcel = useCallback(() => {
    const statusLabels = {
      plan_pre: 'Plan Pre',
      screening_post: 'Post',
      final: 'Final',
      approved: '✓ OK',
      underspend: '↓ Under',
      overspend: '⚠ Over',
    }
    const releaseDateCol = 3
    const rows = sortedActiveFilmsTableRows.map((m) => {
      const planned = movieBudgetTotals[m.film_number] ?? 0
      const revenue = movieIncomeTotals[m.film_number] ?? 0
      const adpub = movieMarketingTotals[m.film_number] ?? 0
      const print = moviePrintTotals[m.film_number] ?? 0
      const pc = [m.profit_center, m.profit_center_2].filter(Boolean).join(' | ') || '—'
      const perf = getFilmPerfStatus(m)
      let statusCell
      if (perf === 'overspend') statusCell = statusLabels.overspend
      else if (perf === 'underspend') statusCell = statusLabels.underspend
      else statusCell = statusLabels[m.budget_status || 'plan_pre'] ?? '—'
      const releaseSerial = releaseDateToExcelSerial(m.release_date)
      return {
        'Film (English)': m.title_en || '',
        'Film (Hebrew)': m.title_he || '',
        'Film #': m.film_number ?? '',
        'Release Date': releaseSerial ?? '',
        'Profit Center': pc,
        'Planned Adpub': planned,
        'Revenue': revenue,
        'AdPub Expenses': adpub,
        'Print Expenses': print,
        'Status': statusCell,
      }
    })
    const ws = XLSX.utils.json_to_sheet(rows)
    const colCount = 10
    const lastDataRow = rows.length

    applyExcelBoldToRow(ws, 0, colCount)
    applyExcelBoldToColumn(ws, 0, 1, lastDataRow)
    applyExcelDateFormatToColumn(ws, releaseDateCol, rows.length)
    for (const col of [5, 6, 7, 8]) {
      applyExcelNumberFormatToColumn(ws, col, 1, lastDataRow)
    }

    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Active Films')
    const stamp = new Date().toISOString().slice(0, 10)
    XLSX.writeFile(wb, `active_films_${stamp}.xlsx`)
  }, [sortedActiveFilmsTableRows, movieBudgetTotals, movieIncomeTotals, movieMarketingTotals, moviePrintTotals, getFilmPerfStatus])

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
      void logActivity(
        'movie_added',
        'New movie added',
        payload.title_en || payload.title_he || '',
        data?.film_number ? String(data.film_number) : null,
      )
      void fetchLastActions()
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
if (passwordRecovery) {
  return <ResetPasswordPage onComplete={completePasswordRecovery} />
}

if (session === undefined || (session && mfaStatus === 'loading' && !passwordRecovery)) {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-gradient-to-br from-[#F4EFFF] via-[#FFF8F0] to-[#EFF9F6]">
      <Loader2 className="h-8 w-8 animate-spin text-[#4B4594]" />
    </div>
  )
}
if (!session) {
  return (
    <LoginPage
      onSessionEstablished={(s) => {
        setSession(s)
        setMfaStatus('loading')
      }}
    />
  )
}

// Dashboard and all authenticated routes require AAL2 (MFA verified in this session).
if (mfaStatus !== 'verified') {
  return (
    <MFAComponent
      onVerified={async () => {
        const verified = await recheckMfa()
        if (verified) {
          window.history.replaceState(null, '', '/dashboard')
        }
      }}
      onSignOut={() => supabase.auth.signOut()}
    />
  )
}

if (currentPage === 'settings') {
  return (
    <div className="min-h-dvh w-full">
      <div className="mx-auto w-full max-w-7xl px-[clamp(1rem,3.5vw,2.5rem)] pb-20 pt-[clamp(2.25rem,7vh,5rem)]">
        <header className="mb-6 border-b border-[rgba(123,82,171,0.22)] pb-6">
          <div className="flex items-center gap-4">
            <div className="flex shrink-0 items-center gap-3">
              <img src={tulipLogo} alt="Tulip logo" className="h-10 w-10 shrink-0 rounded-md object-contain" />
              <p className="flex items-baseline gap-2">
                <span className="font-['Montserrat',sans-serif] text-xl font-extrabold tracking-[0.06em] text-[#4B4594]">TULIP</span>
                <span className="font-['Montserrat',sans-serif] text-xl font-bold uppercase tracking-[0.08em] text-[#F9B233]">Flow</span>
              </p>
            </div>
            <div className="flex flex-1 items-center justify-end gap-2">
              <button type="button" onClick={() => setCurrentPage('dashboard')}
                className="inline-flex items-center gap-1.5 rounded-xl border border-[rgba(74,20,140,0.2)] bg-white px-2.5 py-1.5 text-[11px] font-semibold text-[#4A148C] transition hover:bg-[#F7F2FF]">
                <ArrowLeft className="h-3.5 w-3.5" aria-hidden /> Back to Dashboard
              </button>
              <button type="button" onClick={() => supabase.auth.signOut()}
                className="inline-flex items-center gap-1.5 rounded-xl border border-[rgba(74,20,140,0.2)] bg-white px-2.5 py-1.5 text-[11px] font-semibold text-[#4A148C] transition hover:bg-[#F7F2FF]">
                <LogOut className="h-3.5 w-3.5" aria-hidden /> Sign out
              </button>
            </div>
          </div>
        </header>
        <SettingsPage />
      </div>
    </div>
  )
}

  return (
    <div className="min-h-dvh w-full bg-gradient-to-br from-[#F4EFFF] via-[#FFF8F0] to-[#EFF9F6]">

      <main className="w-full overflow-x-hidden pb-[env(safe-area-inset-bottom)]">

        <div className="mx-auto w-full max-w-7xl px-[clamp(1rem,3.5vw,2.5rem)] pb-20 pt-[clamp(2.25rem,7vh,5rem)]">
            <header className="mb-6 border-b border-[rgba(123,82,171,0.22)] pb-6">
              {/* Three-zone navbar: Logo | Actions | User */}
              <div className="flex items-center gap-4">

                {/* ── Left: Logo + brand ── */}
                <div className="flex shrink-0 items-center gap-3">
                  <img src={tulipLogo} alt="Tulip logo" className="h-12 w-12 shrink-0 rounded-md object-contain" />
                  <p className="flex items-baseline gap-2 leading-none">
                    <span className="font-['Montserrat',sans-serif] text-[1.75rem] font-extrabold tracking-[0.06em] text-[#4B4594] sm:text-3xl">TULIP</span>
                    <span className="font-['Montserrat',sans-serif] text-[1.75rem] font-bold uppercase tracking-[0.08em] text-[#F9B233] sm:text-3xl">Flow</span>
                  </p>
                </div>

                {/* ── Centre: Primary action buttons (flex-1 centres them) ── */}
                <div className="flex flex-1 flex-wrap items-center justify-center gap-2">
                  {/* Add Movie */}
                  <button
                    type="button"
                    onClick={() => { setAddMovieError(null); setAddMovieOpen(true) }}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-[rgba(74,20,140,0.28)] bg-[#4B4594] px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-white shadow-[0_8px_18px_rgba(75,69,148,0.35)] transition hover:bg-[#5a529f]"
                  >
                    <Plus className="h-3.5 w-3.5 shrink-0" aria-hidden />
                    <span className="flex flex-col items-start leading-none gap-[2px]">
                      <span>Add New Film</span>
                      <span className="text-[8px] font-normal normal-case tracking-normal opacity-75">הוספת סרט חדש</span>
                    </span>
                  </button>

                  {/* Upload Budget */}
                  <ExcelUploadButton
                    initialType="budgets"
                    lockType={true}
                    label="Upload Adpub"
                    subLabel="העלאת Adpub"
                    onUploadSuccess={() => { setBudgetRefresh(n => n + 1); void refreshMovies() }}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-[#2FA36B] px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-white shadow-[0_8px_18px_rgba(47,163,107,0.35)] transition hover:bg-[#28915f]"
                  />

                  {/* Upload Monthly PC */}
                  <ExcelUploadButton
                    initialType="journal"
                    lockType={true}
                    label="Upload Monthly PC"
                    subLabel="העלאת מרכז רווח חודשי"
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

            {/* Monthly summary row — loads in parallel with films list */}
            {!loadError && <DashboardSummaryRow studioOptions={studioFilterOptions} />}

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
                <div className="mb-8 grid grid-cols-1 items-stretch gap-4 lg:grid-cols-3">

                  {/* ══ COL 1: Quick Actions + Last PC Upload (full height) ══ */}
                  <div className="flex h-full min-h-0 flex-col gap-6">

                    {/* Quick Actions — compact grid */}
                    <div className="shrink-0 rounded-2xl border border-[rgba(74,20,140,0.15)] bg-white/90 p-5 shadow-[0_8px_28px_rgba(74,20,140,0.08)] backdrop-blur-md">
                      <div className="mb-3 flex items-center gap-2">
                        <Settings className="h-4 w-4 text-[#4B4594]" aria-hidden />
                        <p className="text-[0.6rem] font-bold uppercase tracking-[0.2em] text-[#8A7BAB]">Quick Actions</p>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        {[
                          { label: 'Films',    Icon: Clapperboard, onClick: () => setFilmsManagerOpen(true),           color: '#4B4594' },
                          { label: 'Expenses', Icon: Receipt,      onClick: () => setCatalogsManagerOpen('expenses'),   color: '#0D9488' },
                          { label: 'Rentals',  Icon: Film,         onClick: () => setCatalogsManagerOpen('rentals'),    color: '#E65100' },
                          { label: 'PC Uploads', Icon: History,    onClick: () => setUploadsManagerOpen(true),          color: '#7B52AB' },
                          { label: 'Adpub Uploads', Icon: BookOpen, onClick: () => setBudgetUploadsManagerOpen(true),  color: '#2FA36B' },
                        ].map(({ label, Icon, onClick, color }) => (
                          <button key={label} type="button" onClick={onClick}
                            className="group flex flex-col items-center justify-center gap-1.5 rounded-xl border border-[rgba(74,20,140,0.12)] bg-[#F7F4FB] py-4 text-center transition hover:border-[rgba(74,20,140,0.28)] hover:bg-[#EDE8F8] hover:shadow-sm">
                            <div className="flex h-8 w-8 items-center justify-center rounded-xl transition group-hover:scale-110"
                                 style={{ background: `${color}18` }}>
                              <Icon className="h-4 w-4" style={{ color }} aria-hidden />
                            </div>
                            <span className="text-[10px] font-semibold text-[#4B4594]">{label}</span>
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Last PC Upload per Studio — grows to match column height */}
                    <div className="flex min-h-0 flex-1 flex-col rounded-2xl border border-[rgba(74,20,140,0.15)] bg-white/90 p-5 shadow-[0_8px_28px_rgba(74,20,140,0.08)] backdrop-blur-md">
                      <div className="mb-3 flex shrink-0 items-center gap-2">
                        <TrendingUp className="h-4 w-4 text-[#2FA36B]" aria-hidden />
                        <p className="text-[0.6rem] font-bold uppercase tracking-[0.2em] text-[#8A7BAB]">Last PC Upload per Studio</p>
                      </div>
                      {lastUpdateInfo && lastUpdateInfo.length > 0 ? (
                        <div className="flex min-h-0 flex-1 flex-col gap-2">
                          {Array.from({ length: 5 }, (_, i) => lastUpdateInfo[i] ?? null).map((row, idx) => {
                            if (!row) {
                              return (
                                <div key={`pc-pad-${idx}`} className="min-h-0 flex-1 basis-0" aria-hidden />
                              )
                            }
                            const { studio, period } = row
                            return (
                            <div
                              key={studio}
                              className="flex min-h-0 flex-1 basis-0 items-center justify-between gap-2 rounded-xl bg-[#F7F4FB] px-3 py-2"
                            >
                              <span className="rounded-md bg-[#EDE8F8] px-2 py-0.5 text-[10px] font-bold text-[#4A148C]">{studio}</span>
                              <span className="font-['Montserrat',sans-serif] text-sm font-extrabold text-[#2D1B69]">{period}</span>
                            </div>
                            )
                          })}
                        </div>
                      ) : (
                        <p className="text-sm text-[#C0B8D8]">No imports yet.</p>
                      )}
                    </div>

                  </div>{/* end col 1 */}

                  {/* ══ COL 2: Coming Soon (defines row height) ══ */}
                  <div className="flex h-full min-h-0 flex-col">
                    <div className="flex h-full min-h-0 flex-col rounded-2xl border border-[rgba(74,20,140,0.15)] bg-white/90 p-5 shadow-[0_8px_28px_rgba(74,20,140,0.08)] backdrop-blur-md">
                    <div className="mb-3 flex shrink-0 items-center gap-2">
                      <Calendar className="h-4 w-4 text-[#E65100]" aria-hidden />
                      <p className="text-[0.6rem] font-bold uppercase tracking-[0.2em] text-[#8A7BAB]">Coming Soon</p>
                    </div>
                    {comingSoon.length === 0 ? (
                      <p className="text-sm text-[#C0B8D8]">No upcoming releases found.</p>
                    ) : (
                      <ul className="flex min-h-0 flex-1 flex-col divide-y divide-[rgba(74,20,140,0.1)] border-t border-[rgba(74,20,140,0.1)]">
                        {Array.from({ length: 5 }, (_, i) => comingSoon[i] ?? null).map((m, idx) => {
                          if (!m) {
                            return (
                              <li key={`coming-pad-${idx}`} className="min-h-0 flex-1 basis-0" aria-hidden />
                            )
                          }
                          const d = new Date(m.release_date)
                          const diff = Math.round((d - today) / 86400000)
                          const hasBudget = (movieBudgetTotals[m.film_number] ?? 0) > 0
                          const daysLabel = diff === 0 ? 'Today' : diff === 1 ? 'Tomorrow' : `in ${diff}d`
                          return (
                            <li key={m.film_number} className="flex min-h-[52px] flex-1 basis-0 flex-col justify-center">
                              <button
                                type="button"
                                onClick={() => setSelectedMovie(m)}
                                className="group grid h-full min-h-[3rem] w-full grid-cols-[1fr_auto] items-center gap-x-3 px-3 py-2 text-left transition hover:bg-[#F7F4FB]/80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#4B4594]"
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
                                        Adpub set
                                      </span>
                                    ) : (
                                      <span className="flex items-center gap-1 rounded-md bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-[#D97706] ring-1 ring-amber-200">
                                        <AlertCircle className="h-3 w-3 shrink-0" aria-hidden />
                                        Missing Adpub
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
                  </div>

                  {/* ══ COL 3: Last Actions ══ */}
                  <div className="flex h-full min-h-0 flex-col">
                  <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-[rgba(74,20,140,0.15)] bg-white/90 p-5 shadow-[0_8px_28px_rgba(74,20,140,0.08)] backdrop-blur-md">
                    <div className="mb-3 flex shrink-0 items-center gap-2">
                      <Clock className="h-4 w-4 text-[#7B52AB]" aria-hidden />
                      <p className="text-[0.6rem] font-bold uppercase tracking-[0.2em] text-[#8A7BAB]">Last Actions</p>
                    </div>
                    {lastActions.length === 0 ? (
                      <p className="text-sm text-[#C0B8D8]">No actions recorded yet.</p>
                    ) : (
                      <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto overscroll-contain">
                        {Array.from({ length: LAST_ACTIONS_FEED_LIMIT }, (_, i) => lastActions[i] ?? null).map((action, i) => {
                          if (!action) {
                            return (
                              <div
                                key={`last-action-pad-${i}`}
                                className="min-h-0 flex-1 basis-0"
                                aria-hidden
                              />
                            )
                          }
                          const cfgMap = {
                            status_change:         { Icon: RefreshCw,   iconColor: '#7B52AB', iconBg: '#F4F0FF', label: 'Status updated for' },
                            release_date_edit:     { Icon: Calendar,    iconColor: '#EA580C', iconBg: '#FFF7ED', label: 'Release date updated for' },
                            profit_center_edit:    { Icon: Hash,        iconColor: '#7B52AB', iconBg: '#F4F0FF', label: 'Profit center updated for' },
                            film_number_edit:      { Icon: RefreshCw,   iconColor: '#2563EB', iconBg: '#EFF6FF', label: 'Film number updated for' },
                            budget_upload_per_film:{ Icon: UploadCloud, iconColor: '#0D9488', iconBg: '#F0FDFA', label: 'Adpub uploaded for' },
                            budget_edit:           { Icon: Edit2,       iconColor: '#EA580C', iconBg: '#FFF7ED', label: 'Adpub edited for' },
                            movie_added:           { Icon: PlusCircle,  iconColor: '#2FA36B', iconBg: '#F0FBF5', label: 'New film added' },
                            catalog_edit:          { Icon: ListChecks,  iconColor: '#2563EB', iconBg: '#EFF6FF', label: null },
                            pc_upload_deleted:     { Icon: Trash2Icon,  iconColor: '#C0004C', iconBg: '#FFF1F3', label: null },
                            budget_upload_deleted: { Icon: Trash2Icon,  iconColor: '#C0004C', iconBg: '#FFF1F3', label: 'Adpub deleted for' },
                          }
                          const cfg = cfgMap[action.action_type] ?? { Icon: Clock, iconColor: '#8A7BAB', iconBg: '#F7F4FB', label: null }
                          return (
                            <div
                              key={action.id}
                              className="flex min-h-0 flex-1 basis-0 items-stretch"
                            >
                              <div className="flex h-full min-h-0 w-full items-start gap-2.5 rounded-xl bg-[#F7F4FB] px-3 py-2.5">
                                <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg"
                                     style={{ background: cfg.iconBg }}>
                                  <cfg.Icon className="h-3 w-3" style={{ color: cfg.iconColor }} aria-hidden />
                                </div>
                                <div className="min-w-0 flex-1">
                                  <p className="text-[11px] leading-snug text-[#2D1B69]">
                                    {action.action_type === 'status_change'
                                      ? (() => {
                                          const arrow = action.description?.match(/:\s*(.+?)\s*→\s*(.+)$/)
                                          return (
                                            <>
                                              Status updated
                                              {action.film_title && <> for <strong className="font-semibold">{action.film_title}</strong></>}
                                              {arrow && <span className="text-[#9A7BC0]"> · {arrow[1].trim()} → {arrow[2].trim()}</span>}
                                            </>
                                          )
                                        })()
                                      : (action.action_type === 'catalog_edit' || action.action_type === 'pc_upload_deleted')
                                      ? <span className="text-[#5B4B7A]">{action.description}</span>
                                      : <>
                                          {cfg.label}
                                          {action.film_title
                                            ? <> <strong className="font-semibold">{action.film_title}</strong></>
                                            : action.description && !cfg.label
                                              ? <span className="text-[#5B4B7A]"> {action.description}</span>
                                              : null
                                          }
                                        </>
                                    }
                                  </p>
                                  <p className="mt-0.5 text-[9px] text-[#B0A4CC]">{timeAgo(action.created_at)}</p>
                                </div>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    )}
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
                  {/* ── Toolbar ── */}
                  <div className="mb-5 flex flex-wrap items-center gap-2">

                    {/* Title + count */}
                    <div className="flex shrink-0 items-baseline gap-1.5 mr-1">
                      <h2 className="text-[0.6rem] font-bold uppercase tracking-[0.22em] text-[#4A148C]">Active Films</h2>
                      <span className="rounded-full bg-[#EDE8F8] px-1.5 py-0.5 text-[9px] font-semibold text-[#4B4594]">{filteredMovies.length}</span>
                    </div>

                    {/* Search */}
                    <div className={`flex shrink-0 w-40 items-center gap-1.5 rounded-lg ${brandBorder} bg-white/95 px-2.5 py-1.5 shadow-sm`}>
                      {searchLoading
                        ? <Loader2 className="h-3 w-3 shrink-0 animate-spin text-[#4A148C]" aria-hidden />
                        : <Search className="h-3 w-3 shrink-0 text-[#4A148C]" aria-hidden />}
                      <input
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        placeholder="Search…"
                        className="w-full min-w-0 bg-transparent text-[11px] text-[#5B4B7A] outline-none placeholder:text-[#9A8AB8]"
                      />
                      {searchTerm && (
                        <button type="button" onClick={() => setSearchTerm('')} className="shrink-0 text-[#9A8AB8] hover:text-[#4A148C]">
                          <X className="h-3 w-3" />
                        </button>
                      )}
                    </div>

                    {/* Studio */}
                    <select
                      value={studioFilterOptions.includes(studioFilter) ? studioFilter : ''}
                      onChange={(e) => setStudioFilter(e.target.value)}
                      aria-label="Studio filter"
                      className={`shrink-0 rounded-lg border px-2.5 py-1.5 text-[11px] shadow-sm outline-none transition focus-visible:ring-2 focus-visible:ring-[#4B4594]/35
                        ${studioFilter !== '' && studioFilterOptions.includes(studioFilter)
                          ? 'border-[#4B4594] bg-[#4B4594] font-semibold text-white'
                          : `${brandBorder} bg-white/95 font-medium text-[#5B4B7A] hover:bg-[#F7F2FF] focus:border-[#4B4594]`}`}
                    >
                      <option value="">All Studios</option>
                      {studioFilterOptions.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
                    </select>

                    {/* Release date — compact pill → dropdown */}
                    <div className="relative shrink-0" ref={datePickerRef}>
                      <button
                        type="button"
                        onClick={() => setDatePickerOpen(v => !v)}
                        className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold shadow-sm transition
                          ${(dateFrom || dateTo)
                            ? 'border-[#4B4594] bg-[#4B4594] text-white'
                            : 'border-[rgba(74,20,140,0.18)] bg-white/95 text-[#5B4B7A] hover:bg-[#F7F2FF]'}`}
                      >
                        <Calendar className="h-3 w-3 shrink-0" aria-hidden />
                        {dateFrom || dateTo
                          ? `${dateFrom || '…'} – ${dateTo || '…'}`
                          : 'Release Date'}
                        {(dateFrom || dateTo) && (
                          <span
                            role="button"
                            onClick={e => { e.stopPropagation(); setDateFrom(''); setDateTo(''); setDatePickerOpen(false) }}
                            className="ml-0.5 opacity-70 hover:opacity-100"
                            title="Clear"
                          >
                            <X className="h-2.5 w-2.5" />
                          </span>
                        )}
                      </button>

                      {datePickerOpen && (
                        <div className="absolute left-0 top-full z-[200] mt-1.5 w-64 rounded-xl border border-[rgba(74,20,140,0.15)] bg-white p-3 shadow-[0_12px_32px_rgba(74,20,140,0.18)]">
                          <p className="mb-2 text-[0.55rem] font-bold uppercase tracking-[0.16em] text-[#8A7BAB]">Release Date Range</p>
                          <div className="flex flex-col gap-2">
                            <label className="flex items-center gap-2">
                              <span className="w-8 shrink-0 text-[10px] text-[#9A8AB8]">From</span>
                              <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
                                className="flex-1 rounded-lg border border-[rgba(74,20,140,0.2)] bg-[#FAFAFE] px-2 py-1 text-[11px] text-[#2D1B69] outline-none focus:border-[#4B4594]" />
                            </label>
                            <label className="flex items-center gap-2">
                              <span className="w-8 shrink-0 text-[10px] text-[#9A8AB8]">To</span>
                              <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
                                className="flex-1 rounded-lg border border-[rgba(74,20,140,0.2)] bg-[#FAFAFE] px-2 py-1 text-[11px] text-[#2D1B69] outline-none focus:border-[#4B4594]" />
                            </label>
                          </div>
                          {(dateFrom || dateTo) && (
                            <button type="button" onClick={() => { setDateFrom(''); setDateTo('') }}
                              className="mt-2 w-full rounded-lg border border-[rgba(192,0,76,0.2)] py-1 text-[10px] font-semibold text-[#C0004C] hover:bg-[#FFF1F3]">
                              Clear dates
                            </button>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Status pills */}
                    <div className="flex shrink-0 items-center gap-1">
                      {[
                        { key: '',               label: 'All',        activeBg: '#4B4594', text: '#4B4594' },
                        { key: 'plan_pre',       label: 'Plan Pre',   activeBg: '#4B4594', text: '#4B4594' },
                        { key: 'screening_post', label: 'Post',       activeBg: '#4B4594', text: '#4B4594' },
                        { key: 'final',          label: 'Final',      activeBg: '#4B4594', text: '#4B4594' },
                        { key: 'approved',       label: '✓ OK',       activeBg: '#2FA36B', text: '#2FA36B' },
                        { key: 'underspend',     label: '↓ Under',    activeBg: '#D97706', text: '#D97706' },
                        { key: 'overspend',      label: '⚠ Over',     activeBg: '#C0004C', text: '#C0004C' },
                      ].map(({ key, label, activeBg, text }) => {
                        const isActive = statusFilter === key
                        return (
                          <button key={key} type="button" onClick={() => setStatusFilter(key)}
                            style={isActive ? { background: activeBg, color: '#fff' } : { color: text }}
                            className={`rounded-md px-1.5 py-0.5 text-[10px] font-semibold transition-all
                              ${isActive ? 'shadow-sm' : 'border border-[rgba(74,20,140,0.15)] bg-white/80 hover:bg-[#F7F2FF]'}`}
                          >{label}</button>
                        )
                      })}
                    </div>

                    {(searchTerm.trim() !== '' || studioFilter !== '' || dateFrom || dateTo || statusFilter !== '') && (
                      <button
                        type="button"
                        onClick={() => {
                          setSearchTerm('')
                          setStudioFilter('')
                          setDateFrom('')
                          setDateTo('')
                          setDatePickerOpen(false)
                          setStatusFilter('')
                        }}
                        className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-transparent px-2 py-1 text-[11px] font-medium text-slate-400 transition hover:border-[rgba(74,20,140,0.12)] hover:bg-[#FAFAFE] hover:text-[#4A148C]"
                        title="Clear all Active Films filters"
                      >
                        <XCircle className="h-3.5 w-3.5 shrink-0 opacity-90" aria-hidden />
                        Clear Filters
                      </button>
                    )}

                    <div className="ml-auto flex shrink-0 items-center gap-2">
                      {filmsViewMode === 'table' && filteredMovies.length > 0 && (
                        <button
                          type="button"
                          onClick={exportActiveFilmsTableToExcel}
                          title="Export table to Excel"
                          className="inline-flex items-center gap-1.5 rounded-full border border-[rgba(0,0,0,0.08)] bg-white px-3.5 py-1.5 text-[11px] font-semibold text-[#2FA36B] shadow-sm transition hover:bg-[#F0FBF5] hover:ring-1 hover:ring-[#2FA36B]/25"
                        >
                          <Download className="h-3.5 w-3.5 shrink-0" aria-hidden />
                          Export
                        </button>
                      )}
                      {/* View toggle */}
                      <div className="flex items-center rounded-lg border border-[rgba(74,20,140,0.18)] bg-white/95 p-0.5 shadow-sm">
                        <button type="button"
                          onClick={() => setFilmsViewMode('card')}
                          title="Card view"
                          className={`flex items-center justify-center rounded-md p-1.5 transition ${filmsViewMode === 'card' ? 'bg-[#4B4594] text-white shadow-sm' : 'text-[#8A7BAB] hover:text-[#4B4594]'}`}>
                          <LayoutGrid className="h-3.5 w-3.5" aria-hidden />
                        </button>
                        <button type="button"
                          onClick={() => setFilmsViewMode('table')}
                          title="Table view"
                          className={`flex items-center justify-center rounded-md p-1.5 transition ${filmsViewMode === 'table' ? 'bg-[#4B4594] text-white shadow-sm' : 'text-[#8A7BAB] hover:text-[#4B4594]'}`}>
                          <List className="h-3.5 w-3.5" aria-hidden />
                        </button>
                      </div>
                    </div>
                  </div>

                  {filteredMovies.length === 0 ? (
                    <p className="py-6 text-center text-sm text-[#4A148C]">
                      {movies.length === 0
                        ? 'No films yet. Use "Add new film" to create a title.'
                        : isSearching
                          ? 'No films match your search.'
                          : (studioFilter || statusFilter || dateFrom || dateTo)
                            ? 'No films match the current filters.'
                            : `No films scheduled for ${new Date().getFullYear()}. Use search to open titles from other years.`}
                    </p>
                  ) : filmsViewMode === 'card' ? (
                    <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                      {filteredMovies.map((m) => (
                        <li key={m.film_number}>
                          <SortableMovieCard
                            movie={m}
                            totalBudget={movieBudgetTotals[m.film_number] ?? 0}
                            actualSpent={movieMarketingTotals[m.film_number] ?? 0}
                            revenue={movieIncomeTotals[m.film_number] ?? 0}
                            printSpent={moviePrintTotals[m.film_number] ?? 0}
                            latestMonthLabel={movieLatestMonth[m.film_number]?.slice(0, 7) ?? null}
                            latestMonthExpenses={movieMonthlyExp[m.film_number] ?? 0}
                            latestMonthIncome={movieMonthlyInc[m.film_number] ?? 0}
                            isSelected={selectedMovie?.film_number === m.film_number}
                            onSelect={() => setSelectedMovie(selectedMovie?.film_number === m.film_number ? null : m)}
                          />
                        </li>
                      ))}
                    </ul>
                  ) : (
                    /* ── Table View ───────────────────────────────────────── */
                    (() => {
                      const COLS = [
                        { label: 'Film',           key: 'title_en',      align: 'left',  width: '14%', sortable: true },
                        { label: 'Film #',         key: 'film_number',   align: 'left',  width: '8%',  sortable: true },
                        { label: 'Release Date',   key: 'release_date',  align: 'left',  width: '9%',  sortable: true },
                        { label: 'Profit Center',  key: 'profit_center', align: 'left',  width: '10%', sortable: true },
                        { label: 'Planned Adpub', key: 'planned',       align: 'right', width: '10%', sortable: true },
                        { label: 'Revenue',        key: 'revenue',       align: 'right', width: '9%',  sortable: true },
                        { label: 'AdPub Exp.',     key: 'adpub',         align: 'right', width: '11%', sortable: true },
                        { label: 'Print Exp.',     key: 'print',         align: 'right', width: '9%',  sortable: true },
                        { label: 'Status',         key: 'budget_status', align: 'left',  width: '7%',  sortable: true },
                        { label: '',               key: '_actions',      align: 'right', width: '13%', sortable: false },
                      ]

                      const handleColSort = (key) => {
                        if (tableSortCol === key) {
                          setTableSortDir(d => d === 'asc' ? 'desc' : 'asc')
                        } else {
                          setTableSortCol(key)
                          setTableSortDir('asc')
                        }
                      }

                      const tableRows = sortedActiveFilmsTableRows

                      return (
                    <div className="overflow-x-auto rounded-xl border border-[rgba(74,20,140,0.1)]">
                      <table className="w-full min-w-[1040px] table-fixed border-collapse text-left text-[12px]">
                        <colgroup>
                          {COLS.map(({ key, width }) => (
                            <col key={key} style={{ width }} />
                          ))}
                        </colgroup>
                        <thead>
                          <tr style={{ background: '#2D1B69' }}>
                            {COLS.map(({ label, key, align, sortable = true }) => {
                              const isActive = sortable && tableSortCol === key
                              return (
                                <th key={key}
                                  onClick={sortable ? () => handleColSort(key) : undefined}
                                  className={`select-none px-3 py-2.5 text-[0.55rem] font-bold uppercase tracking-[0.14em] whitespace-nowrap transition-colors ${sortable ? 'cursor-pointer hover:bg-white/10' : ''}`}
                                  style={{ textAlign: align, color: isActive ? '#ffffff' : 'rgba(255,255,255,0.65)' }}>
                                  {sortable ? (
                                    <span className={`flex w-full items-center gap-1 ${align === 'right' ? 'justify-end' : ''}`}>
                                      {label}
                                      {isActive
                                        ? <span className="text-white">{tableSortDir === 'asc' ? ' ↑' : ' ↓'}</span>
                                        : <span className="opacity-30">↕</span>}
                                    </span>
                                  ) : null}
                                </th>
                              )
                            })}
                          </tr>
                        </thead>
                        <tbody>
                          {tableRows.map((m, i) => {
                            const planned = movieBudgetTotals[m.film_number] ?? 0
                            const revenue = movieIncomeTotals[m.film_number] ?? 0
                            const adpub   = movieMarketingTotals[m.film_number] ?? 0
                            const print   = moviePrintTotals[m.film_number] ?? 0
                            const fmtCur  = (n) => n === 0 ? '—' : '₪' + n.toLocaleString('en-IL', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
                            const statusCfg = {
                              plan_pre:       { label: 'Plan Pre', bg: '#EDE8F8', color: '#4B4594' },
                              screening_post: { label: 'Post',     bg: '#FFF7E0', color: '#B45309' },
                              final:          { label: 'Final',    bg: '#DCFCE7', color: '#166534' },
                              approved:       { label: '✓ OK',     bg: '#DCFCE7', color: '#166534' },
                              underspend:     { label: '↓ Under',  bg: '#FEF3C7', color: '#D97706' },
                              overspend:      { label: '⚠ Over',   bg: '#FEE2E2', color: '#B91C1C' },
                            }
                            const perf = getFilmPerfStatus(m)
                            const effectiveBudgetStatus = m.budget_status || 'plan_pre'
                            const sc =
                              perf === 'overspend' ? statusCfg.overspend
                              : perf === 'underspend' ? statusCfg.underspend
                              : statusCfg[effectiveBudgetStatus] ?? { label: '—', bg: '#F7F4FB', color: '#8A7BAB' }
                            const isEditing = activeTableEditingId === m.film_number
                            const statusEditableInRow = isEditing && activeTableDraft.statusEditable === true
                            const rowBg = isEditing ? '#F7F2FF' : (i % 2 === 0 ? '#FAFAFE' : '#FFFFFF')
                            return (
                              <tr key={m.film_number}
                                onClick={isEditing ? undefined : () => setSelectedMovie(m)}
                                className={`border-b border-[rgba(74,20,140,0.07)] transition-colors ${isEditing ? 'bg-[#F7F2FF]' : 'cursor-pointer hover:bg-[#F0EBFF]'}`}
                                style={{ background: rowBg }}>

                                {/* Film names */}
                                <td className="px-3 py-2.5 min-w-0" onClick={(e) => isEditing && e.stopPropagation()}>
                                  {isEditing ? (
                                    <div className="space-y-1.5">
                                      <FilmTableInput
                                        value={activeTableDraft.title_en}
                                        onChange={(v) => patchActiveTableDraft('title_en', v)}
                                        placeholder="English title"
                                        className="text-xs"
                                      />
                                      <FilmTableInput
                                        value={activeTableDraft.title_he}
                                        onChange={(v) => patchActiveTableDraft('title_he', v)}
                                        placeholder="שם בעברית"
                                        dir="rtl"
                                        className="text-xs"
                                      />
                                    </div>
                                  ) : (
                                    <>
                                      <p className="font-semibold text-[#2D1B69] leading-snug">{m.title_en || '—'}</p>
                                      {m.title_he && (
                                        <p className="text-[10px] text-[#9A8AB8] mt-0.5" dir="rtl" lang="he">{m.title_he}</p>
                                      )}
                                    </>
                                  )}
                                </td>

                                {/* Film number */}
                                <td className="px-3 py-2.5 min-w-0" onClick={(e) => isEditing && e.stopPropagation()}>
                                  {isEditing ? (
                                    <>
                                      <FilmTableInput
                                        value={activeTableDraft.film_number}
                                        onChange={(v) => patchActiveTableDraft('film_number', v)}
                                        placeholder="Film #"
                                        className="font-['JetBrains_Mono',ui-monospace,monospace] text-xs"
                                      />
                                      {activeTableDraft.film_number !== m.film_number && (
                                        <p className="mt-1 flex items-center gap-1 text-[10px] text-amber-600">
                                          <AlertTriangle className="h-3 w-3 shrink-0" />
                                          Cascades to Adpub, expenses & income
                                        </p>
                                      )}
                                    </>
                                  ) : (
                                    <span className="whitespace-nowrap font-['JetBrains_Mono',ui-monospace,monospace] text-[11px] text-[#5B4B7A]">
                                      {m.film_number ?? '—'}
                                    </span>
                                  )}
                                </td>

                                {/* Release date */}
                                <td className="px-3 py-2.5 min-w-0" onClick={(e) => isEditing && e.stopPropagation()}>
                                  {isEditing ? (
                                    <FilmTableInput
                                      type="date"
                                      value={activeTableDraft.release_date}
                                      onChange={(v) => patchActiveTableDraft('release_date', v)}
                                      className="text-xs"
                                    />
                                  ) : (
                                    <span className="whitespace-nowrap text-[11px] text-[#5B4B7A]">
                                      {formatReleaseDate(m.release_date) ?? '—'}
                                    </span>
                                  )}
                                </td>

                                {/* Profit center(s) */}
                                <td className="px-3 py-2.5 min-w-0" onClick={(e) => isEditing && e.stopPropagation()}>
                                  {isEditing ? (
                                    <div className="space-y-1.5">
                                      <FilmTableInput
                                        value={activeTableDraft.profit_center}
                                        onChange={(v) => patchActiveTableDraft('profit_center', v)}
                                        placeholder="Profit center"
                                        className="font-['JetBrains_Mono',ui-monospace,monospace] text-xs"
                                      />
                                      <FilmTableInput
                                        value={activeTableDraft.profit_center_2}
                                        onChange={(v) => patchActiveTableDraft('profit_center_2', v)}
                                        placeholder="Profit center 2"
                                        className="font-['JetBrains_Mono',ui-monospace,monospace] text-xs"
                                      />
                                    </div>
                                  ) : (
                                    <div className="flex flex-wrap gap-1">
                                      {m.profit_center && (
                                        <span className="rounded bg-[#EDE8F8] px-1.5 py-0.5 font-['JetBrains_Mono',ui-monospace,monospace] text-[10px] font-semibold text-[#4A148C]">
                                          {m.profit_center}
                                        </span>
                                      )}
                                      {m.profit_center_2 && (
                                        <span className="rounded bg-[#E8F0FE] px-1.5 py-0.5 font-['JetBrains_Mono',ui-monospace,monospace] text-[10px] font-semibold text-[#1E40AF]">
                                          {m.profit_center_2}
                                        </span>
                                      )}
                                      {!m.profit_center && !m.profit_center_2 && <span className="text-[#C0B8D8]">—</span>}
                                    </div>
                                  )}
                                </td>

                                {/* Planned Adpub — read-only (journal/budget sourced) */}
                                <td className="px-3 py-2.5 min-w-0 align-top">
                                  <span className="block text-right whitespace-nowrap font-['JetBrains_Mono',ui-monospace,monospace] text-[11px] font-semibold tabular-nums text-[#2D1B69]">
                                    {fmtCur(planned)}
                                  </span>
                                </td>

                                {/* Revenue — read-only */}
                                <td className="px-3 py-2.5 min-w-0 align-top">
                                  <span className="block text-right whitespace-nowrap font-['JetBrains_Mono',ui-monospace,monospace] text-[11px] font-semibold tabular-nums text-[#2FA36B]">
                                    {fmtCur(revenue)}
                                  </span>
                                </td>

                                {/* AdPub expenses — read-only */}
                                <td className="px-3 py-2.5 min-w-0 align-top">
                                  {(() => {
                                    const rawRatio = planned > 0 ? (adpub / planned) * 100 : adpub > 0 ? 100 : 0
                                    const usedLabel =
                                      planned > 0 || adpub > 0 ? `${rawRatio.toFixed(0)}% used` : '—'
                                    return (
                                      <div className="flex flex-col items-end justify-center font-['JetBrains_Mono',ui-monospace,monospace]">
                                        <span className="whitespace-nowrap text-[11px] font-semibold tabular-nums text-[#2D1B69]">
                                          {fmtCur(adpub)}
                                        </span>
                                        <span className="whitespace-nowrap pt-0.5 text-xs tabular-nums text-slate-400">
                                          {usedLabel}
                                        </span>
                                      </div>
                                    )
                                  })()}
                                </td>

                                {/* Print expenses — read-only */}
                                <td className="px-3 py-2.5 min-w-0 align-top">
                                  <span className="block text-right whitespace-nowrap font-['JetBrains_Mono',ui-monospace,monospace] text-[11px] tabular-nums text-[#7B52AB]">
                                    {fmtCur(print)}
                                  </span>
                                </td>

                                {/* Status */}
                                <td
                                  className="min-w-0 align-top px-3 py-2.5 pr-2"
                                  onClick={(e) => isEditing && e.stopPropagation()}
                                >
                                  {isEditing && statusEditableInRow ? (
                                    <FilmTableSelect
                                      value={activeTableDraft.status ?? 'plan_pre'}
                                      onChange={(v) => patchActiveTableDraft('status', v)}
                                      options={ACTIVE_FILMS_WORKFLOW_STATUS_OPTIONS}
                                      className="text-xs"
                                    />
                                  ) : (
                                    <span className="inline-block rounded-md px-2 py-0.5 text-[10px] font-bold whitespace-nowrap"
                                      style={{ background: sc.bg, color: sc.color }}>
                                      {sc.label}
                                    </span>
                                  )}
                                </td>

                                {/* Actions */}
                                <td
                                  className="min-w-0 align-top border-l border-[rgba(74,20,140,0.12)] py-2.5 pl-4 pr-3 text-right"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  {isEditing ? (
                                    <div className="flex min-h-[34px] flex-row flex-nowrap items-center justify-end gap-1">
                                      <button
                                        type="button"
                                        onClick={() => void handleActiveTableSave(m)}
                                        disabled={activeTableSaving}
                                        className="inline-flex shrink-0 items-center gap-0.5 rounded-md bg-[#2FA36B] px-2 py-1 text-[10px] font-semibold leading-tight text-white transition hover:bg-[#28915f] disabled:opacity-50"
                                      >
                                        {activeTableSaving ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <Save className="h-2.5 w-2.5" />}
                                        Save
                                      </button>
                                      <button
                                        type="button"
                                        onClick={cancelActiveTableEdit}
                                        disabled={activeTableSaving}
                                        className="inline-flex shrink-0 items-center gap-0.5 rounded-md border border-[rgba(74,20,140,0.2)] bg-white px-2 py-1 text-[10px] font-semibold leading-tight text-[#4A148C] transition hover:bg-[#F7F2FF] disabled:opacity-50"
                                      >
                                        <X className="h-2.5 w-2.5" /> Cancel
                                      </button>
                                    </div>
                                  ) : (
                                    <button
                                      type="button"
                                      onClick={() => startActiveTableEdit(m)}
                                      className="inline-flex items-center gap-1 rounded-lg border border-[rgba(74,20,140,0.2)] px-2.5 py-1.5 text-[11px] font-semibold text-[#4A148C] transition hover:bg-[#F7F2FF]"
                                    >
                                      <Edit2 className="h-3 w-3" /> Edit
                                    </button>
                                  )}
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                      ) // end return
                    })() // end IIFE
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
            setSelectedMovie(prev => ({ ...prev, budget_status: newStatus }))
            const oldStatus = film.budget_status || 'plan_pre'
            const statusLabel = { plan_pre: 'Plan Pre', screening_post: 'Screening Post', final: 'Final' }
            void logActivity(
              'status_change',
              `Status updated: ${statusLabel[oldStatus] ?? oldStatus} → ${statusLabel[newStatus] ?? newStatus}`,
              film.title_en || film.title_he,
              film.film_number,
            )
            void fetchLastActions()
            void refreshMovies()
          } catch (err) {
            console.error('Status save error:', err)
          } finally {
            setBudgetStatusSaving(false)
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

            {/* ── Compact dashboard header ── */}
            <div className="shrink-0 border-b border-[rgba(74,20,140,0.14)] bg-white px-5 py-2 shadow-sm">
              {(() => {
                const perfStatus = computePerfStatus()
                const manualStatus = film.budget_status || 'plan_pre'
                const rawPct = filmBudget > 0 ? filmSpent / filmBudget : 0
                const barPct = Math.min(rawPct, 1)
                const overBudget = filmSpent > filmBudget
                const kpis = [
                  { label: 'Planned', value: filmBudget, color: '#4B4594' },
                  { label: 'Spent', value: filmSpent, color: '#C0392B' },
                  { label: 'Balance', value: filmBalance, color: filmBalance >= 0 ? '#2FA36B' : '#E61E6E' },
                  { label: 'Revenue', value: filmIncome, color: '#0EA5A0' },
                  ...(totalPrint > 0 ? [{ label: 'Print', value: totalPrint, color: '#7B52AB' }] : []),
                ]
                return (
                  <div className="flex flex-col items-stretch gap-2.5 xl:flex-row xl:items-start xl:justify-between">
                    <div className="min-w-0 flex-1 xl:pr-3">
                      <p className="pl-9 text-[0.58rem] font-semibold uppercase tracking-[0.18em] text-[#A193C4]">Adpub Overview</p>
                      <div className="mt-0.5 flex min-w-0 items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setSelectedMovie(null)}
                          aria-label="Back to Dashboard"
                          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[#4A148C] transition hover:bg-[#EDE8F8] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#4B4594]"
                        >
                          <ArrowLeft className="h-4 w-4" aria-hidden />
                        </button>
                        <p className="truncate font-['Montserrat',sans-serif] text-[1.06rem] font-extrabold text-[#4A148C]">
                          {movieTitleEnglish(film)}
                        </p>
                      </div>
                      {movieTitleHebrewSubtitle(film) && (
                        <p className="mt-0.5 pl-9 text-[13px] text-[#9A8AB8]" lang="he">{movieTitleHebrewSubtitle(film)}</p>
                      )}
                      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 pl-9 text-[11px] text-[#6A5B88]">
                        {movieStudioAndCodeLabel(film)}
                        {film.profit_center && <span className="font-['JetBrains_Mono',ui-monospace,monospace] text-[#7B52AB]">PC {film.profit_center}</span>}
                        {film.profit_center_2 && <span className="font-['JetBrains_Mono',ui-monospace,monospace] text-[#7B52AB]">PC2 {film.profit_center_2}</span>}
                        {formatReleaseDate(film.release_date) && (
                          <span className="inline-flex items-center gap-1 rounded-md bg-[#FFF3E0] px-1.5 py-0.5 text-[10px] font-semibold text-[#E65100]">
                            <Calendar className="h-2.5 w-2.5" aria-hidden />
                            {formatReleaseDate(film.release_date)}
                          </span>
                        )}
                      </div>
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5 pl-9">
                        <div className="flex items-center gap-0.5 rounded-lg bg-[#F0EBFF] p-0.5">
                          {WORKFLOW_STAGES.map(({ key, label }) => {
                            const isActive = manualStatus === key
                            return (
                              <button
                                key={key}
                                type="button"
                                disabled={budgetStatusSaving}
                                onClick={() => !budgetStatusSaving && saveWorkflowStatus(key)}
                                style={isActive ? { background: '#4B4594', color: '#fff' } : {}}
                                className={`rounded-md px-2 py-0.5 text-[10px] font-semibold transition-all ${isActive ? 'shadow-sm' : 'text-[#8A7BAB] hover:bg-white/60'}`}
                              >
                                {label}
                              </button>
                            )
                          })}
                        </div>
                        {perfStatus === 'approved' && (
                          <span className="inline-flex items-center gap-1 rounded-md border border-[#A7F3D0] bg-[#F0FBF5] px-2 py-0.5 text-[10px] font-bold text-[#2FA36B]">✓ Approved</span>
                        )}
                        {perfStatus === 'underspend' && (
                          <span className="inline-flex items-center gap-1 rounded-md border border-[#FDE68A] bg-[#FFFBEB] px-2 py-0.5 text-[10px] font-bold text-[#D97706]">↓ Underspend</span>
                        )}
                        {perfStatus === 'overspend' && (
                          <span className="inline-flex items-center gap-1 rounded-md border border-[#FFBAC8] bg-[#FFF1F3] px-2 py-0.5 text-[10px] font-bold text-[#C0004C]">⚠ Overspend</span>
                        )}
                        {budgetStatusSaving && <span className="text-[9px] italic text-[#8A7BAB]">Saving…</span>}
                      </div>
                    </div>

                    <div className="w-full rounded-xl border border-[rgba(74,20,140,0.12)] bg-[#FCFBFF] p-2 xl:w-auto xl:min-w-[560px]">
                      <div className="flex items-center justify-end gap-1.5">
                        <ExcelUploadButton
                          initialType="budgets"
                          label="Upload Adpub"
                          contextFilm={film}
                          onUploadSuccess={() => { setBudgetRefresh(n => n + 1); void refreshMovies() }}
                          className="inline-flex items-center gap-1 rounded-lg bg-[#2FA36B] px-3 py-1.5 text-[11px] font-semibold text-white shadow-sm transition hover:bg-[#28915f]"
                        />
                      </div>

                      <div className="mt-1.5 grid grid-cols-2 gap-1.5 md:grid-cols-3 xl:grid-cols-5">
                        {kpis.map(({ label, value, color }) => (
                          <div key={label} className="rounded-md border border-[rgba(74,20,140,0.1)] bg-[#F7F2FF] px-2 py-1 text-right">
                            <p className="text-[0.48rem] font-semibold uppercase tracking-[0.12em] text-[#8A7BAB]">{label}</p>
                            <p className="font-['Montserrat',sans-serif] text-[11px] font-extrabold tabular-nums" style={{ color }}>
                              {formatCurrency(value)}
                            </p>
                          </div>
                        ))}
                      </div>

                      {filmBudget > 0 && (
                        <div className="mt-1.5 rounded-md border border-[rgba(74,20,140,0.1)] bg-[#FAFAFE] px-2 py-1.5">
                          <div className="mb-1 flex items-center justify-between text-[10px] font-semibold text-[#8A7BAB]">
                            <span>Adpub used</span>
                            <span style={{ color: overBudget ? '#C0004C' : '#2FA36B' }}>
                              {(rawPct * 100).toFixed(1)}%
                              {overBudget && ' — Over'}
                            </span>
                          </div>
                          <div className="h-1.5 w-full overflow-hidden rounded-full bg-[#ECE7F7]">
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
                        </div>
                      )}
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
              <div className="h-2" aria-hidden="true" />

              {budgetLoading && (
                <div className="flex items-center justify-center py-20">
                  <Loader2 className="h-8 w-8 animate-spin text-[#4B4594]" />
                </div>
              )}

              {budgetError && (
                <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{budgetError}</p>
              )}

              {!budgetLoading && !budgetError && budgetRows.length === 0 && !budgetEditMode && (
                <div className="mx-auto max-w-xl rounded-2xl border border-[rgba(74,20,140,0.14)] bg-white p-8 shadow-[0_8px_32px_rgba(74,20,140,0.08)]">
                  <h3 className="font-['Montserrat',sans-serif] text-base font-bold text-[#4B4594]">
                    No Adpub data yet
                  </h3>
                  <p className="mt-2 text-sm leading-relaxed text-[#6A5B88]">
                    Import a spreadsheet with <span className="font-semibold text-[#4B4594]">Upload Adpub</span> in the header above,
                    or add line items manually below.
                  </p>
                  <div className="relative my-8">
                    <div className="absolute inset-0 flex items-center" aria-hidden>
                      <div className="w-full border-t border-[rgba(74,20,140,0.12)]" />
                    </div>
                    <div className="relative flex justify-center">
                      <span className="bg-white px-3 text-[11px] font-medium uppercase tracking-wider text-[#9A8AB8]">
                        or enter manually
                      </span>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => startBudgetEditEmpty()}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-[rgba(74,20,140,0.2)] bg-[#FAFAFE] px-4 py-3 text-sm font-semibold text-[#4A148C] transition hover:border-[#4B4594] hover:bg-[#F4F0FF]"
                  >
                    <PlusCircle className="h-4 w-4 shrink-0" aria-hidden />
                    Add Adpub Row
                  </button>
                </div>
              )}

              {/* ── Main budget table ── */}
              {!budgetLoading && !budgetError && (budgetRows.length > 0 || budgetEditMode) && (() => {
                // Manual entry when no Adpub loaded yet — flat editor on draft rows
                if (budgetRows.length === 0 && budgetEditMode) {
                  return (
                    <>
                      <div className="flex shrink-0 items-center justify-end gap-2 border-b border-[rgba(74,20,140,0.1)] bg-white px-6 py-3">
                        <button
                          type="button"
                          onClick={cancelBudgetEdit}
                          disabled={budgetSaving}
                          className="rounded-xl border border-[rgba(74,20,140,0.2)] bg-white px-4 py-2 text-sm font-semibold text-[#8A7BAB] transition hover:bg-slate-50 disabled:opacity-50"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          onClick={() => void saveBudgetEdit()}
                          disabled={budgetSaving}
                          className="inline-flex items-center gap-2 rounded-xl bg-[#2FA36B] px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-[#28915f] disabled:opacity-50"
                        >
                          {budgetSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                          Save Changes
                        </button>
                      </div>
                      {budgetSaveToast && (
                        <div className={`mx-6 mt-4 flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold ${
                          budgetSaveToast === 'success'
                            ? 'border border-[rgba(47,163,107,0.3)] bg-[#F0FBF5] text-[#1a7a4e]'
                            : 'border border-red-200 bg-red-50 text-red-700'
                        }`}>
                          {budgetSaveToast === 'success' ? '✓ Adpub saved successfully.' : '✗ Save failed — please try again.'}
                        </div>
                      )}
                      <div className="px-6 py-6">
                        <p className="mb-4 text-sm leading-relaxed text-[#6A5B88]">
                          Enter planned amounts for each line item, then save. You can add more rows with the button below.
                        </p>
                        <div className="overflow-visible rounded-xl border border-[rgba(74,20,140,0.14)] bg-white shadow-sm">
                          <table className="w-full border-collapse text-sm">
                            <thead>
                              <tr className="bg-[#F7F2FF]">
                                {['Item name', 'Vendor', 'Planned (₪)', 'Media code', 'Media?', 'Actions'].map((h) => (
                                  <th key={h} className="px-3 py-2 text-left text-[0.6rem] font-bold uppercase tracking-wider text-[#8A7BAB]">
                                    {h}
                                  </th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {draftRows.map((row) => (
                                <tr key={row.id} className="border-t border-[rgba(74,20,140,0.08)]">
                                  <td className="p-2">
                                    <input
                                      type="text"
                                      value={row.categoryName}
                                      onChange={(e) => patchBudgetDraftField(row.id, 'categoryName', e.target.value)}
                                      placeholder="Category / item name"
                                      className="w-full rounded-lg border border-[rgba(74,20,140,0.2)] px-2 py-1.5 text-sm outline-none focus:border-[#4B4594] focus:ring-2 focus:ring-[#4B4594]/20"
                                    />
                                  </td>
                                  <td className="p-2">
                                    <input
                                      type="text"
                                      value={row.vendorName}
                                      onChange={(e) => patchBudgetDraftField(row.id, 'vendorName', e.target.value)}
                                      placeholder="Vendor"
                                      className="w-full rounded-lg border border-[rgba(74,20,140,0.2)] px-2 py-1.5 text-sm outline-none focus:border-[#4B4594] focus:ring-2 focus:ring-[#4B4594]/20"
                                    />
                                  </td>
                                  <td className="p-2">
                                    <input
                                      type="number"
                                      min="0"
                                      step="100"
                                      value={row.budget}
                                      onChange={(e) => patchBudgetDraftField(row.id, 'budget', Number(e.target.value))}
                                      className="w-full rounded-lg border border-[rgba(74,20,140,0.2)] px-2 py-1.5 text-right text-sm outline-none focus:border-[#4B4594] focus:ring-2 focus:ring-[#4B4594]/20"
                                    />
                                  </td>
                                  <td className="p-2">
                                    {(() => {
                                      const query = String(row.mediaCode ?? '').trim().toLowerCase()
                                      const filteredCodes = adpubMediaCodeSearchOptions
                                        .filter((code) => code.toLowerCase().includes(query))
                                        .slice(0, 60)
                                      return (
                                        <div className="relative">
                                          <input
                                            type="text"
                                            value={row.mediaCode ?? ''}
                                            onFocus={() => setOpenMediaCodeRowId(row.id)}
                                            onChange={(e) => {
                                              patchBudgetDraftField(row.id, 'mediaCode', e.target.value)
                                              setOpenMediaCodeRowId(row.id)
                                            }}
                                            placeholder={adpubMediaCodeOptionsLoading ? 'טוען קודי מדיה…' : 'בחר או חפש קוד מדיה…'}
                                            dir="rtl"
                                            className="w-full rounded-lg border border-[rgba(74,20,140,0.2)] bg-[#FCFBFF] px-2.5 py-1.5 pr-8 text-sm font-semibold tracking-[0.01em] text-[#2D1B69] outline-none transition focus:border-[#4B4594] focus:ring-2 focus:ring-[#4B4594]/20"
                                          />
                                          <button
                                            type="button"
                                            tabIndex={-1}
                                            aria-label="Toggle media code options"
                                            onMouseDown={(e) => e.preventDefault()}
                                            onClick={() => setOpenMediaCodeRowId((prev) => (prev === row.id ? null : row.id))}
                                            className="absolute inset-y-0 left-1.5 flex items-center text-[#6F63A8] hover:text-[#4B4594]"
                                          >
                                            <ChevronDown className={`h-4 w-4 transition-transform ${openMediaCodeRowId === row.id ? 'rotate-180' : ''}`} />
                                          </button>

                                          {openMediaCodeRowId === row.id && (
                                            <div className="absolute left-0 right-0 z-50 mt-1 max-h-56 overflow-y-auto rounded-xl border border-[rgba(74,20,140,0.18)] bg-white py-1 shadow-[0_14px_34px_rgba(46,26,102,0.22)]">
                                              {filteredCodes.length > 0 ? filteredCodes.map((code) => (
                                                <button
                                                  key={code}
                                                  type="button"
                                                  dir="rtl"
                                                  onMouseDown={(e) => {
                                                    e.preventDefault()
                                                    patchBudgetDraftField(row.id, 'mediaCode', code)
                                                    setOpenMediaCodeRowId(null)
                                                  }}
                                                  className="block w-full px-3 py-1.5 text-right text-sm font-medium text-[#3C2A78] transition hover:bg-[#F1EBFF]"
                                                >
                                                  {code}
                                                </button>
                                              )) : (
                                                <div className="px-3 py-2 text-right text-xs text-[#8A7BAB]">
                                                  לא נמצאו התאמות
                                                </div>
                                              )}
                                            </div>
                                          )}
                                        </div>
                                      )
                                    })()}
                                  </td>
                                  <td className="p-2 text-center">
                                    <input
                                      type="checkbox"
                                      checked={row.isMedia === true}
                                      onChange={(e) => patchBudgetDraftField(row.id, 'isMedia', e.target.checked)}
                                      className="h-4 w-4 rounded border-[rgba(74,20,140,0.3)] text-[#4B4594]"
                                    />
                                  </td>
                                  <td className="p-2 text-center">
                                    <button
                                      type="button"
                                      onClick={() => removeBudgetDraftRow(row.id)}
                                      className="inline-flex items-center justify-center rounded-md border border-[rgba(230,30,110,0.28)] bg-[#FFF1F6] p-1.5 text-[#C0004C] transition hover:bg-[#FFE4EE]"
                                      title="Delete line"
                                      aria-label="Delete line"
                                    >
                                      <Trash2Icon className="h-3.5 w-3.5" aria-hidden />
                                    </button>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                          <div className="border-t border-[rgba(74,20,140,0.1)] p-3">
                            <button
                              type="button"
                              onClick={addBudgetDraftRow}
                              className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-semibold text-[#4A148C] transition hover:bg-[#EDE8F8]"
                            >
                              <PlusCircle className="h-3.5 w-3.5" />
                              Add Adpub Row
                            </button>
                          </div>
                        </div>
                      </div>
                    </>
                  )
                }

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
                    onChange={e => patchBudgetDraftField(row.id, field, type === 'number' ? Number(e.target.value) : e.target.value)}
                    className="w-full rounded-md border border-[rgba(74,20,140,0.25)] bg-white px-2 py-1 text-[12.5px] text-[#2D1B69] outline-none focus:border-[#4B4594] focus:ring-1 focus:ring-[#4B4594]/30"
                    placeholder={field === 'categoryName' ? 'Item name…' : field === 'vendorName' ? 'Vendor…' : '0'}
                  />
                )

                const mediaToggle = (row) => (
                  <button
                    type="button"
                    title={row.isMedia === true ? 'Media' : row.isMedia === false ? 'Non-Media' : 'Unknown'}
                    onClick={() => {
                      patchBudgetDraftField(row.id, 'isMedia', row.isMedia !== true)
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
                              ? (
                                <div className="flex items-center gap-1">
                                  {editInput(row, 'categoryName')}
                                  {mediaToggle(row)}
                                  <button
                                    type="button"
                                    onClick={() => removeBudgetDraftRow(row.id)}
                                    className="ml-1 inline-flex items-center justify-center rounded-md border border-[rgba(230,30,110,0.28)] bg-[#FFF1F6] p-1 text-[#C0004C] transition hover:bg-[#FFE4EE]"
                                    title="Delete line"
                                    aria-label="Delete line"
                                  >
                                    <Trash2Icon className="h-3.5 w-3.5" aria-hidden />
                                  </button>
                                </div>
                              )
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
                                  onChange={e => patchBudgetDraftField(row.id, 'budget', Number(e.target.value))}
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
                              onClick={() => {
                                const groupMediaHint = rows.find((r) => r.isMedia === true)?.isMedia === true
                                  ? true
                                  : rows.find((r) => r.isMedia === false)?.isMedia === false
                                  ? false
                                  : false
                                addBudgetDraftRowWithPrefill({ mediaCode: code || '', isMedia: groupMediaHint })
                              }}
                              className="flex items-center gap-1.5 rounded-lg px-3 py-1 text-[11px] font-semibold text-[#4B4594] transition hover:bg-[#EDE8F8]"
                            >
                              <span className="text-base leading-none">+</span> Add Adpub Line
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
                  const blankRow = () => ({
                    Category: '', 'Item Name': '', Vendor: '',
                    'Planned (₪)': '', 'Actual (₪)': '', 'Revenue (₪)': '', 'Variance (₪)': '',
                  })

                  // Film-level KPIs — actual/revenue only on rows with Category (column A)
                  rows.push({ ...blankRow(), Category: '── Film Summary ──' })
                  rows.push({ ...blankRow(), Category: 'Planned Adpub', 'Planned (₪)': filmBudget })
                  rows.push({ ...blankRow(), Category: 'Total Spent (Actual)', 'Actual (₪)': filmSpent })
                  rows.push({ ...blankRow(), Category: 'Balance', 'Variance (₪)': filmBalance })
                  rows.push({ ...blankRow(), Category: 'Total Revenue', 'Revenue (₪)': filmIncome })
                  rows.push(blankRow())

                  const addSection = (label, groupEntries) => {
                    if (groupEntries.length === 0) return
                    rows.push({ ...blankRow(), Category: label })
                    for (const [groupKey, { code, rows: budgetRows }] of groupEntries) {
                      const groupBudget   = budgetRows.reduce((s, r) => s + (Number(r.budget) || 0), 0)
                      const groupActual   = actualByCode[groupKey] ?? 0
                      const groupVariance = groupBudget - groupActual

                      // Group subtotal — actuals are keyed by media_budget_code (same as on-screen parent row)
                      rows.push({
                        ...blankRow(),
                        Category:       code || 'No Code',
                        'Item Name':    `Subtotal (${budgetRows.length} line${budgetRows.length === 1 ? '' : 's'})`,
                        'Planned (₪)':  groupBudget,
                        'Actual (₪)':   groupActual,
                        'Variance (₪)': groupVariance,
                      })

                      for (const r of budgetRows) {
                        rows.push({
                          ...blankRow(),
                          'Item Name':   r.categoryName || '',
                          Vendor:        r.vendorName || '',
                          'Planned (₪)': Number(r.budget) || 0,
                        })
                      }
                    }
                  }

                  if (budgetFilter === 'all' && hasMediaFlag) {
                    addSection('Media Spend', mediaGroups)
                    addSection('Non-Media Spend', nonMediaGroups)
                  } else {
                    addSection('Adpub', visibleGroups)
                  }

                  if (budgetFilter === 'all' && mediaGroups.length > 0 && nonMediaGroups.length > 0) {
                    rows.push({
                      ...blankRow(),
                      Category: 'Section Totals',
                      'Planned (₪)': mediaTotals.planned + nonMediaTotals.planned,
                      'Actual (₪)': mediaTotals.actual + nonMediaTotals.actual,
                      'Variance (₪)': mediaTotals.variance + nonMediaTotals.variance,
                    })
                  }

                  // Unrecognized expenses (no matching budget code)
                  if (showUnmapped && unmappedActuals.length > 0) {
                    rows.push({
                      ...blankRow(),
                      Category:       '⚠ Unrecognized Expenses',
                      'Actual (₪)':   unmappedTotal,
                      'Variance (₪)': -unmappedTotal,
                    })
                    for (const r of unmappedActuals) {
                      rows.push({
                        ...blankRow(),
                        'Item Name': r.expense_description || r.media_budget_code || '—',
                      })
                    }
                  }

                  rows.push({
                    ...blankRow(),
                    Category:       'GRAND TOTAL (Adpub)',
                    'Planned (₪)':  visibleTotals.planned,
                    'Actual (₪)':   visibleTotals.actual,
                    'Variance (₪)': visibleTotals.variance,
                  })

                  // Print — two blank rows below Grand Total, then print section
                  if (printRows.length > 0) {
                    rows.push(blankRow(), blankRow())
                    rows.push({ ...blankRow(), Category: 'Print & Technical (excl. from budget)' })
                    for (const r of printRows) {
                      rows.push({
                        ...blankRow(),
                        Category:     r.media_budget_code || r.priority_code || '—',
                        'Item Name':  r.expense_description || '—',
                        'Actual (₪)': Number(r.actual_amount) || 0,
                      })
                    }
                  }

                  const ws = XLSX.utils.json_to_sheet(rows)
                  const lastDataRow = rows.length
                  const colCount = 7

                  applyExcelBoldToRow(ws, 0, colCount)
                  for (let i = 0; i < rows.length; i++) {
                    if (String(rows[i].Category ?? '').trim() !== '') {
                      applyExcelBoldToRow(ws, i + 1, colCount)
                    }
                  }
                  for (const col of [3, 4, 5, 6]) {
                    applyExcelNumberFormatToColumn(ws, col, 1, lastDataRow)
                  }

                  ws['!cols'] = [
                    { wch: 22 },  // Category
                    { wch: 36 },  // Item Name
                    { wch: 22 },  // Vendor
                    { wch: 16 },  // Planned
                    { wch: 16 },  // Actual
                    { wch: 16 },  // Revenue
                    { wch: 16 },  // Variance
                  ]

                  const wb = XLSX.utils.book_new()
                  XLSX.utils.book_append_sheet(wb, ws, 'Adpub')
                  XLSX.writeFile(wb, `${filmTitle}_adpub.xlsx`)
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
                      {budgetSaveToast === 'success' ? '✓ Adpub saved successfully.' : '✗ Save failed — please try again.'}
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
                          <button type="button" onClick={() => startBudgetEditFromLoaded()}
                            className="flex items-center gap-1.5 rounded-xl border border-[rgba(74,20,140,0.2)] bg-white px-3 py-1.5 text-[11px] font-semibold text-[#4A148C] transition hover:bg-[#F4F0FF]">
                            <Edit2 className="h-3.5 w-3.5" aria-hidden /> Edit Adpub
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                          <button type="button" onClick={() => cancelBudgetEdit()} disabled={budgetSaving}
                            className="rounded-xl border border-[rgba(74,20,140,0.2)] bg-white px-3 py-1.5 text-[11px] font-semibold text-[#8A7BAB] transition hover:bg-slate-50 disabled:opacity-50">
                            Cancel
                          </button>
                          <button type="button" onClick={() => void saveBudgetEdit()} disabled={budgetSaving}
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
                                        title="Create an Adpub line for this expense"
                                        onClick={(e) => {
                                          e.stopPropagation()
                                          const code        = r.media_budget_code?.trim() || ''
                                          const isMediaHint = r.expense_type === 'מדיה'
                                          addBudgetDraftRowWithPrefill({
                                            categoryName: r.expense_description || r.priority_code || '',
                                            vendorName:   r.studio_name || '',
                                            budget:       Number(r.actual_amount) || 0,
                                            mediaCode:    code,
                                            isMedia:      isMediaHint,
                                          })
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

      {budgetUploadsManagerOpen && (
        <BudgetUploadsManagementModal onClose={() => setBudgetUploadsManagerOpen(false)} />
      )}

      {activeTableConfirmFnChange && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center p-4"
          onMouseDown={(e) => { if (e.target === e.currentTarget) setActiveTableConfirmFnChange(null) }}
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
                {activeTableConfirmFnChange.oldFn}
              </code>{' '}
              to{' '}
              <code className="rounded bg-[#F4F1FF] px-1.5 py-0.5 font-['JetBrains_Mono',ui-monospace,monospace] text-xs text-[#7B52AB]">
                {activeTableConfirmFnChange.newFn}
              </code>
            </p>
            <p className="mb-5 text-xs leading-relaxed text-[#8A7BAB]">
              All linked rows in <strong>Adpub</strong>, <strong>Actual Expenses</strong>, and <strong>Rental Transactions</strong> will be updated to the new film number.
            </p>
            {activeTableSaveError && (
              <p className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{activeTableSaveError}</p>
            )}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setActiveTableConfirmFnChange(null)}
                disabled={activeTableSaving}
                className="rounded-xl border border-[rgba(74,20,140,0.2)] bg-white px-4 py-2 text-sm font-semibold text-[#4A148C] transition hover:bg-[#F7F2FF] disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void executeActiveTableFilmUpdate(
                  activeTableConfirmFnChange.oldFn,
                  activeTableConfirmFnChange.newFn,
                  activeTableConfirmFnChange.filmPayload,
                  activeTableConfirmFnChange.actionMeta,
                )}
                disabled={activeTableSaving}
                className="inline-flex items-center gap-2 rounded-xl bg-amber-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-amber-600 disabled:opacity-50"
              >
                {activeTableSaving && <Loader2 className="h-4 w-4 animate-spin" />}
                Yes, update all tables
              </button>
            </div>
          </div>
        </div>
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
                Add new film
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
                  Film name (Hebrew)
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
                  Film name (English)
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
                  {addMovieBusy ? 'Saving…' : 'Save film'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  )
}
