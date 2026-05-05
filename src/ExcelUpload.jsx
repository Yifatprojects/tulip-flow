import { useState, useRef, useEffect } from 'react'
import * as XLSX from 'xlsx'
import {
  Upload,
  X,
  CheckCircle,
  AlertTriangle,
  Calendar,
  BookOpen,
  FileSpreadsheet,
  Loader2,
  Film,
  DollarSign,
  Receipt,
  Truck,
  TrendingUp,
  ChevronDown,
  ChevronUp,
  TableProperties,
} from 'lucide-react'
import { supabase } from './lib/supabaseClient'

// ─── Table / column configuration ────────────────────────────────────────────
//
// columnMap keys  : normalised Excel header  (lowercase, single spaces)
// columnMap values: exact Supabase column name
//
// Primary Excel key for all tables: "Film number"  →  film_number
//
const TYPE_CONFIG = {
  films: {
    label: 'Films',
    table: 'films',
    icon: Film,
    color: '#4B4594',
    bgColor: 'bg-[#F4F1FF]',
    borderColor: 'border-[rgba(75,69,148,0.4)]',
    description: 'Master film registry — add or update film records',
    requiresFilmCheck: false,
    upsertConflict: 'film_number', // upsert so re-uploads are safe
    columnMap: {
      // ── film_number ──────────────────────────────────────
      'film number': 'film_number',
      film_number:   'film_number',
      id:            'film_number',
      'film no':     'film_number',
      filmno:        'film_number',
      // ── title_en ─────────────────────────────────────────
      title:         'title_en',
      title_en:      'title_en',
      'title (english)': 'title_en',
      'film title':  'title_en',
      name:          'title_en',
      'film name':   'title_en',
      english:       'title_en',
      // ── title_he ─────────────────────────────────────────
      'title (hebrew)':  'title_he',
      title_he:      'title_he',
      hebrew:        'title_he',
      'שם הסרט':     'title_he',
      // ── studio ───────────────────────────────────────────
      studio:        'studio',
      studio_name:   'studio',
      'studio name': 'studio',
      'production company': 'studio',
      // ── release_date ─────────────────────────────────────
      'release date': 'release_date',
      release_date:   'release_date',
      releasedate:    'release_date',
      date:           'release_date',
      year:           'release_date',
      // ── director ─────────────────────────────────────────
      director:       'director',
      // ── status ───────────────────────────────────────────
      status:         'status',
    },
    dateFields:    ['release_date'],
    numericFields: [],
    required:      [], // film_number is auto-generated when missing
    mappingTable: [
      ['Film number', 'film_number', 'Optional – auto-generated from title if blank'],
      ['Title',       'title_en',    'Film title in English'],
      ['Title (Hebrew)', 'title_he', 'Optional'],
      ['Studio',      'studio',      'Optional'],
      ['Release Date','release_date','Optional – YYYY-MM-DD'],
      ['Director',    'director',    'Optional'],
      ['Status',      'status',      'Optional'],
    ],
    exampleHeaders: 'Film number | Title       | Studio    | Release Date',
    exampleRow:     'WB001       | The Movie   | Universal | 2026-06-15',
    summaryTemplate: (count, _u, autoGen) =>
      `Successfully imported ${count} film${count === 1 ? '' : 's'}${autoGen > 0 ? ` (${autoGen} film number${autoGen === 1 ? '' : 's'} auto-generated)` : ''}.`,
  },

  budgets: {
    label: 'Budgets',
    table: 'budgets',
    icon: DollarSign,
    color: '#2FA36B',
    bgColor: 'bg-[#F0FBF5]',
    borderColor: 'border-[rgba(47,163,107,0.4)]',
    description: 'Budget template — film name/number in A2, line items from row 3 onward',
    requiresFilmCheck: true,
    requiresExpensesCheck: false,
    upsertConflict: null,
    columnMap: {}, // unused — parseRows handles all column extraction
    dateFields:    [],
    numericFields: [], // handled inside parseRows
    required:      [], // validated inside parseRows

    /**
     * Template-aware row parser for the budgets upload.
     *
     * Expected layout:
     *   Row 1  – header row (שם | סכום | קוד תקציב מדיה | שם הספק | מדיה)  → skipped
     *   Row 2  – A2 = film name/number, B2 = total approved budget           → A2 extracted, row skipped as data
     *   Row 3+ – one budget line per row
     *   Any row where col A is empty or contains 'סה"כ' is ignored (totals).
     */
    parseRows: (ws) => {
      // ── Extract film_number from A2 ──────────────────────
      const filmNumber = String(ws['A2']?.v ?? '').trim()
      if (!filmNumber) {
        throw new Error(
          'Cell A2 is empty. Please put the film name or number in cell A2 and try again.',
        )
      }

      // ── Get all rows as arrays (header: 1 → no auto-header row) ──
      const allRows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null })

      // Skip header row (index 0), film-name row (index 1 = Excel row 2),
      // and the internal-use row (index 2 = Excel row 3)
      const dataRows = allRows.slice(3)

      const results = []
      for (const [rowIdx, row] of dataRows.entries()) {
        const aVal = row[0]
        const aStr = String(aVal ?? '').trim()

        // Skip empty col A or any subtotal / total row
        if (!aStr || aStr.includes('סה"כ')) continue

        // planned_amount — strip commas, spaces, currency symbols (₪ $)
        const rawAmt = String(row[1] ?? '').replace(/[,₪$\s]/g, '')
        const planned_amount = parseFloat(rawAmt) || 0

        // is_media boolean — accept Hebrew and English
        const mediaRaw = String(row[4] ?? '').trim().toLowerCase()
        const is_media =
          mediaRaw === 'yes' || mediaRaw === 'כן'
            ? true
            : mediaRaw === 'no' || mediaRaw === 'לא'
            ? false
            : null

        const out = {
          _row: rowIdx + 4, // 1-based Excel row for error messages (data starts at row 4)
          film_number: filmNumber,
          budget_item_name: aStr,
          planned_amount,
        }

        const code = String(row[2] ?? '').trim()
        if (code) out.media_budget_code = code

        const vendor = String(row[3] ?? '').trim()
        if (vendor) out.vendor_name = vendor

        if (is_media !== null) out.is_media = is_media

        results.push(out)
      }

      if (results.length === 0) {
        throw new Error(
          'No budget line items found. Make sure data starts in row 3 and column A is not empty or "סה"כ".',
        )
      }

      return results
    },

    mappingTable: [
      ['A2',                     'film_number',       'Film name / number read from cell A2'],
      ['A – שם',                 'budget_item_name',  'Budget line item name (rows 3+)'],
      ['B – סכום',               'planned_amount',    'Planned amount – commas and ₪ stripped automatically'],
      ['C – קוד תקציב מדיה',     'media_budget_code', 'Optional – media budget code'],
      ['D – שם הספק',            'vendor_name',       'Optional – vendor / supplier name'],
      ['E – מדיה',               'is_media',          '"yes" / "כן" → true   |   "no" / "לא" → false'],
    ],
    exampleHeaders: 'Row 1 (headers): שם | סכום | קוד תקציב מדיה | שם הספק | מדיה',
    exampleRow:     'A2: WB001 (film)  ·  Row 3+: Post Production | 150,000 | MED-01 | Studio X | yes',
    summaryTemplate: (count) =>
      `Successfully imported ${count} budget line item${count === 1 ? '' : 's'}.`,
  },

  expenses: {
    label: 'Expenses',
    table: 'expenses',
    icon: Receipt,
    color: '#E61E6E',
    bgColor: 'bg-[#FFF0F6]',
    borderColor: 'border-[rgba(230,30,110,0.4)]',
    description: 'Expense category catalog — priority codes and descriptions (no film link)',
    requiresFilmCheck: false,
    requiresExpensesCheck: false,
    upsertConflict: 'priority_code', // PK — safe to re-import
    columnMap: {
      // ── priority_code (PK) ────────────────────────────────
      'קוד פריוריטי':  'priority_code',
      'priority code': 'priority_code',
      priority_code:   'priority_code',
      priority:        'priority_code',
      // ── expense_description ──────────────────────────────
      'תיאור הוצאה':       'expense_description',
      'expense description': 'expense_description',
      expense_description:   'expense_description',
      description:           'expense_description',
      name:                  'expense_description',
      // ── media_budget_code ────────────────────────────────
      'קוד תקציב מדיה':  'media_budget_code',
      'media budget code': 'media_budget_code',
      media_budget_code:   'media_budget_code',
      'media code':        'media_budget_code',
      // ── expense_type ─────────────────────────────────────
      'סוג הוצאה':   'expense_type',
      'expense type': 'expense_type',
      expense_type:   'expense_type',
      type:           'expense_type',
      // ── reporting_code ───────────────────────────────────
      'קוד דיווח הוצאות': 'reporting_code',
      'reporting code':    'reporting_code',
      reporting_code:      'reporting_code',
    },
    dateFields:    [],
    numericFields: [],
    required:      ['priority_code'],
    mappingTable: [
      ['קוד פריוריטי / Priority Code',           'priority_code',       'Required – primary key'],
      ['תיאור הוצאה / Expense Description',       'expense_description', 'Category name / label'],
      ['קוד תקציב מדיה / Media Budget Code',      'media_budget_code',   'Optional'],
      ['סוג הוצאה / Expense Type',                'expense_type',        'Optional – e.g. Production, Marketing'],
      ['קוד דיווח הוצאות / Reporting Code',        'reporting_code',      'Optional – secondary code'],
    ],
    exampleHeaders: 'קוד פריוריטי | תיאור הוצאה       | סוג הוצאה  | קוד דיווח הוצאות',
    exampleRow:     'EXP-001      | Post Production  | Production | REP-001',
    summaryTemplate: (count) =>
      `Successfully imported ${count} expense categor${count === 1 ? 'y' : 'ies'}.`,
  },

  actual_expenses: {
    label: 'Monthly Expenses',
    table: 'actual_expenses',
    icon: Receipt,
    color: '#C0392B',
    bgColor: 'bg-[#FFF5F5]',
    borderColor: 'border-[rgba(192,57,43,0.4)]',
    description: 'Monthly actual expenses per film, linked to expense categories',
    requiresFilmCheck: true,
    requiresExpensesCheck: true, // validates priority_code exists in expenses table
    upsertConflict: null,
    columnMap: {
      // ── film_number ──────────────────────────────────────
      'film number':  'film_number',
      film_number:    'film_number',
      id:             'film_number',
      'film no':      'film_number',
      // ── month_period ─────────────────────────────────────
      month:          'month_period',
      month_period:   'month_period',
      'month period': 'month_period',
      period:         'month_period',
      // ── actual_amount ────────────────────────────────────
      'actual amount': 'actual_amount',
      actual_amount:   'actual_amount',
      actual:          'actual_amount',
      amount:          'actual_amount',
      cost:            'actual_amount',
      // ── studio_name ──────────────────────────────────────
      studio:       'studio_name',
      studio_name:  'studio_name',
      'studio name': 'studio_name',
      // ── priority_code (FK → expenses) ────────────────────
      'קוד פריוריטי':  'priority_code',
      'priority code': 'priority_code',
      priority_code:   'priority_code',
      priority:        'priority_code',
    },
    dateFields:    [],
    numericFields: ['actual_amount'],
    required:      ['film_number', 'actual_amount'],
    mappingTable: [
      ['Film number',                  'film_number',    'Required – must exist in Films'],
      ['Actual Amount',                'actual_amount',  'Required – numeric'],
      ['Month',                        'month_period',   'Optional – e.g. 2026-04'],
      ['Studio',                       'studio_name',    'Optional'],
      ['קוד פריוריטי / Priority Code', 'priority_code',  'Optional – links to Expense category'],
    ],
    exampleHeaders: 'Film number | קוד פריוריטי | Month   | Actual Amount | Studio',
    exampleRow:     'WB001       | EXP-001      | 2026-04 | 8500          | Universal',
    summaryTemplate: (count, uniqueFilms) =>
      `Successfully imported ${count} expense record${count === 1 ? '' : 's'} for ${uniqueFilms} different film${uniqueFilms === 1 ? '' : 's'}.`,
  },

  rentals: {
    label: 'Rentals',
    table: 'rentals',
    icon: Truck,
    color: '#F9B233',
    bgColor: 'bg-[#FFFBF0]',
    borderColor: 'border-[rgba(249,178,51,0.5)]',
    description: 'Income category catalog — priority codes and descriptions (no film link)',
    requiresFilmCheck: false,
    upsertConflict: 'priority_code', // PK — safe to re-import
    columnMap: {
      // ── priority_code (PK) ────────────────────────────────
      'קוד פריוריטי':  'priority_code',  // Hebrew header
      'priority code': 'priority_code',
      priority_code:   'priority_code',
      priority:        'priority_code',
      // ── income_description ───────────────────────────────
      'תיאור הכנסה':      'income_description', // Hebrew header
      'income description': 'income_description',
      income_description:   'income_description',
      description:          'income_description',
      name:                 'income_description',
      'category name':      'income_description',
      category:             'income_description',
      // ── reporting_code ───────────────────────────────────
      'קוד דיווח הכנסות': 'reporting_code', // Hebrew header
      'reporting code':    'reporting_code',
      reporting_code:      'reporting_code',
      'report code':       'reporting_code',
      // ── format_type ──────────────────────────────────────
      'סוג הפורמט':  'format_type',    // Hebrew header
      'format type': 'format_type',
      format_type:   'format_type',
      format:        'format_type',
      type:          'format_type',
      medium:        'format_type',
    },
    dateFields:    [],
    numericFields: [],
    required:      ['priority_code'],
    mappingTable: [
      ['קוד פריוריטי / Priority Code',       'priority_code',      'Required – primary key'],
      ['תיאור הכנסה / Income Description',   'income_description', 'Category name / label'],
      ['קוד דיווח הכנסות / Reporting Code',  'reporting_code',     'Optional – secondary code'],
      ['סוג הפורמט / Format Type',           'format_type',        'Optional – e.g. Digital, VOD'],
    ],
    exampleHeaders: 'קוד פריוריטי | תיאור הכנסה           | קוד דיווח הכנסות | סוג הפורמט',
    exampleRow:     'P-001        | Video on Demand Sales | VOD-001           | Digital',
    summaryTemplate: (count) =>
      `Successfully imported ${count} rental categor${count === 1 ? 'y' : 'ies'}.`,
  },

  rental_transactions: {
    label: 'Income',
    table: 'rental_transactions',
    icon: TrendingUp,
    color: '#0EA5A0',
    bgColor: 'bg-[#F0FAFA]',
    borderColor: 'border-[rgba(14,165,160,0.4)]',
    description: 'Monthly rental income per film and reporting code',
    requiresFilmCheck: true,
    upsertConflict: null,
    columnMap: {
      // ── film_number ──────────────────────────────────────
      'film number':  'film_number',
      film_number:    'film_number',
      id:             'film_number',
      'film no':      'film_number',
      // ── month_period ─────────────────────────────────────
      month:          'month_period',
      month_period:   'month_period',
      'month period': 'month_period',
      period:         'month_period',
      date:           'month_period',
      // ── actual_amount ────────────────────────────────────
      'actual amount': 'actual_amount',
      actual_amount:   'actual_amount',
      actual:          'actual_amount',
      amount:          'actual_amount',
      income:          'actual_amount',
      revenue:         'actual_amount',
      // ── priority_code (FK → rentals) ─────────────────────
      'קוד פריוריטי':  'priority_code',  // Hebrew header
      'priority code': 'priority_code',
      priority_code:   'priority_code',
      priority:        'priority_code',
      // ── reporting_code (kept for reference) ──────────────
      'קוד דיווח הכנסות': 'reporting_code',
      'reporting code':    'reporting_code',
      reporting_code:      'reporting_code',
    },
    dateFields:    [],
    numericFields: ['actual_amount'],
    required:      ['film_number', 'actual_amount'],
    mappingTable: [
      ['Film number',                               'film_number',    'Required – must exist in Films'],
      ['Actual Amount',                             'actual_amount',  'Required – numeric'],
      ['Month',                                     'month_period',   'Optional – e.g. 2026-04 or April 2026'],
      ['קוד פריוריטי / Priority Code',              'priority_code',  'Optional – links to Rentals catalog'],
      ['קוד דיווח הכנסות / Reporting Code',         'reporting_code', 'Optional – secondary code'],
    ],
    exampleHeaders: 'Film number | קוד פריוריטי | Month   | Actual Amount',
    exampleRow:     'WB001       | P-001        | 2026-04 | 12500',
    summaryTemplate: (count, uniqueFilms) =>
      `Successfully imported ${count} income record${count === 1 ? '' : 's'} for ${uniqueFilms} different film${uniqueFilms === 1 ? '' : 's'}.`,
  },

  journal: {
    label: 'Journal',
    table: null, // smart-routed — no single table
    icon: BookOpen,
    color: '#4B4594',
    bgColor: 'bg-[#F4F0FF]',
    borderColor: 'border-[rgba(75,69,148,0.4)]',
    description: 'Monthly journal entry — routes rows to Expenses or Income by priority code',
    requiresFilmCheck: false, // validated in previewJournal
    requiresExpensesCheck: false,
    upsertConflict: null,
    columnMap: {},
    dateFields: [],
    numericFields: [],
    required: [],
    mappingTable: [
      ['C – חשבון',       'priority_code',  'Routes row → actual_expenses (if in Expenses catalog) or rental_transactions (if in Rentals catalog)'],
      ['D – תאור חשבון', 'description',    'Display / log only — not saved'],
      ['E – מרכז רווח',  'film_number',    'Must exist in Films table'],
      ['F – סכום',        'actual_amount',  'Required – numeric amount'],
    ],
    exampleHeaders: '... | C (חשבון) | D (תאור) | E (מרכז רווח) | F (סכום)',
    exampleRow:     '... | EXP-001   | Marketing | 7036973       | 15000',
    summaryTemplate: () => '',
  },
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function normaliseHeader(h) {
  return String(h ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
}

function parseDateValue(value) {
  if (value == null) return null
  if (value instanceof Date) {
    return isNaN(value.getTime()) ? null : value.toISOString().slice(0, 10)
  }
  const s = String(value).trim()
  if (!s) return null
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  const d = new Date(s)
  return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10)
}

/**
 * Auto-generate a film_number from the title or a random suffix.
 * e.g. "The Dark Knight" → "THE-DARK-KNIGHT-A3F1"
 */
function generateFilmNumber(row) {
  const title = String(row.title_en ?? row.title_he ?? '').trim()
  const slug = title
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 18)
  const suffix = Math.random().toString(36).slice(2, 6).toUpperCase()
  return slug ? `${slug}-${suffix}` : `FILM-${suffix}`
}

/** Read the first sheet of an .xlsx/.xls file and return rows as plain objects */
function parseExcelFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target.result)
        const workbook = XLSX.read(data, { type: 'array', cellDates: true })
        const firstSheet = workbook.Sheets[workbook.SheetNames[0]]
        const rows = XLSX.utils.sheet_to_json(firstSheet, { defval: null })
        resolve(rows)
      } catch (err) {
        reject(new Error(`Excel parse error: ${err.message}`))
      }
    }
    reader.onerror = () => reject(new Error('Could not read the file.'))
    reader.readAsArrayBuffer(file)
  })
}

/** Apply the column map to a single raw Excel row */
function mapRow(rawRow, columnMap) {
  const mapped = {}
  for (const [rawKey, value] of Object.entries(rawRow)) {
    const dbCol = columnMap[normaliseHeader(rawKey)]
    // first match wins (so "Film number" beats an alias)
    if (dbCol && !(dbCol in mapped)) mapped[dbCol] = value
  }
  return mapped
}

// ─── Core upload logic ────────────────────────────────────────────────────────

async function processUpload(file, typeKey) {
  const config = TYPE_CONFIG[typeKey]

  // 1 ─ Parse Excel → JSON rows
  // 1 / 2 ─ Parse rows ─────────────────────────────────────────────────────
  //   • If the config provides a parseRows() template parser, use it directly —
  //     it handles column extraction, filtering, and type coercions internally.
  //   • Otherwise fall back to the generic sheet_to_json → columnMap flow.
  let rows

  if (typeof config.parseRows === 'function') {
    const buf = await file.arrayBuffer()
    const wb = XLSX.read(buf, { cellDates: true, type: 'array' })
    const ws = wb.Sheets[wb.SheetNames[0]]
    rows = config.parseRows(ws) // throws with a user-friendly message on bad input
  } else {
    const rawRows = await parseExcelFile(file)
    if (rawRows.length === 0) throw new Error('No data rows found in the Excel file.')
    rows = rawRows
      .map((r, i) => ({ ...mapRow(r, config.columnMap), _row: i + 2 }))
      .filter(({ _row, ...rest }) =>
        Object.values(rest).some((v) => v != null && String(v).trim() !== ''),
      )
  }

  if (rows.length === 0) throw new Error('All rows are empty after filtering blank lines.')

  // 2b ─ For template-parsed types (e.g. budgets): A2 may contain a film title
  //      instead of the actual film_number. Resolve it by looking up title_en / title_he
  //      so users can put either "Primate" or "7036973" in A2.
  if (typeof config.parseRows === 'function' && rows.length > 0 && rows[0].film_number) {
    const rawId = String(rows[0].film_number).trim()

    const { data: exactMatch } = await supabase
      .from('films')
      .select('film_number')
      .eq('film_number', rawId)
      .maybeSingle()

    if (!exactMatch) {
      // Not a valid film_number — try matching against title_en or title_he
      const { data: titleMatch } = await supabase
        .from('films')
        .select('film_number, title_en, title_he')
        .or(`title_en.ilike.${rawId},title_he.ilike.${rawId}`)
        .maybeSingle()

      if (titleMatch) {
        // Replace the raw title with the real film_number on every row
        for (const row of rows) row.film_number = titleMatch.film_number
      }
      // If still not found, the requiresFilmCheck below will surface a clear error
    }
  }

  // 3a ─ For Films: auto-generate film_number when the column is missing/blank
  let autoGeneratedCount = 0
  if (typeKey === 'films') {
    for (const row of rows) {
      if (!row.film_number || String(row.film_number).trim() === '') {
        row.film_number = generateFilmNumber(row)
        autoGeneratedCount++
      }
    }
  }

  // 3b ─ Validate required columns for other types
  const validationErrors = []
  for (const { _row, ...data } of rows) {
    for (const col of config.required) {
      if (data[col] == null || String(data[col]).trim() === '') {
        validationErrors.push(`Row ${_row}: required column "${col}" is missing or empty.`)
      }
    }
  }
  if (validationErrors.length > 0) {
    const shown = validationErrors.slice(0, 20)
    const extra =
      validationErrors.length > 20 ? `\n…and ${validationErrors.length - 20} more.` : ''
    throw new Error(shown.join('\n') + extra)
  }

  // 4a ─ Integrity check: all film_numbers must exist in the films table
  if (config.requiresFilmCheck) {
    const uniqueIds = [
      ...new Set(rows.map((r) => String(r.film_number ?? '').trim()).filter(Boolean)),
    ]

    const { data: found, error: checkErr } = await supabase
      .from('films')
      .select('film_number')
      .in('film_number', uniqueIds)

    if (checkErr) throw new Error(`Could not verify film IDs: ${checkErr.message}`)

    const foundSet = new Set((found ?? []).map((f) => f.film_number))
    const missing = uniqueIds.filter((id) => !foundSet.has(id))

    if (missing.length > 0) {
      throw new Error(
        `These Film Numbers don't exist in the Films table yet:\n${missing.join(', ')}\n\nPlease import the Films sheet first, then retry.`,
      )
    }
  }

  // 4b ─ Integrity check: priority_codes must exist in the expenses catalog
  if (config.requiresExpensesCheck) {
    const uniqueCodes = [
      ...new Set(rows.map((r) => String(r.priority_code ?? '').trim()).filter(Boolean)),
    ]

    if (uniqueCodes.length > 0) {
      const { data: found, error: checkErr } = await supabase
        .from('expenses')
        .select('priority_code')
        .in('priority_code', uniqueCodes)

      if (checkErr) throw new Error(`Could not verify expense codes: ${checkErr.message}`)

      const foundSet = new Set((found ?? []).map((e) => e.priority_code))
      const missing = uniqueCodes.filter((c) => !foundSet.has(c))

      if (missing.length > 0) {
        throw new Error(
          `These Priority Codes don't exist in the Expenses catalog yet:\n${missing.join(', ')}\n\nPlease import the Expenses sheet first, then retry.`,
        )
      }
    }
  }

  // 5 ─ Build final insert objects (type coercions + strip blanks)
  const inserts = rows.map(({ _row, ...data }) => {
    const out = { ...data }

    // film_number must always be a clean string
    if (out.film_number != null) out.film_number = String(out.film_number).trim()

    // For Films: title_en cannot be null — fall back to Hebrew title or film_number
    if (typeKey === 'films') {
      const en = out.title_en != null ? String(out.title_en).trim() : ''
      const he = out.title_he != null ? String(out.title_he).trim() : ''
      out.title_en = en || he || out.film_number || 'Untitled'
    }

    for (const field of config.dateFields) {
      if (out[field] !== undefined) out[field] = parseDateValue(out[field])
    }
    for (const field of config.numericFields) {
      if (out[field] != null)
        out[field] = Number(String(out[field]).replace(/[,\s]/g, '')) || 0
    }

    // Remove null / empty-string optional fields → let Supabase use column defaults
    for (const k of Object.keys(out)) {
      if (out[k] == null || String(out[k]).trim() === '') delete out[k]
    }

    return out
  })

  // 6 ─ Deduplicate by upsert key before sending.
  //     PostgreSQL rejects "ON CONFLICT DO UPDATE" when the same key appears
  //     more than once in a single batch — last row wins.
  let finalInserts = inserts
  if (config.upsertConflict) {
    const seen = new Map()
    for (const row of inserts) {
      const key = row[config.upsertConflict]
      seen.set(key, row) // later rows overwrite earlier ones with the same key
    }
    finalInserts = [...seen.values()]
    if (finalInserts.length < inserts.length) {
      console.info(
        `[ExcelUpload] Removed ${inserts.length - finalInserts.length} duplicate(s) before upsert.`,
      )
    }
  }

  // 7 ─ Bulk insert (single Supabase call for best performance).
  //     Fall back to 500-row chunks only when the payload exceeds Supabase's limit.
  const CHUNK = 500
  if (finalInserts.length <= CHUNK) {
    let res
    if (config.upsertConflict) {
      res = await supabase
        .from(config.table)
        .upsert(finalInserts, { onConflict: config.upsertConflict })
    } else {
      res = await supabase.from(config.table).insert(finalInserts)
    }
    if (res.error) throw new Error(res.error.message)
  } else {
    for (let i = 0; i < finalInserts.length; i += CHUNK) {
      const chunk = finalInserts.slice(i, i + CHUNK)
      let res
      if (config.upsertConflict) {
        res = await supabase
          .from(config.table)
          .upsert(chunk, { onConflict: config.upsertConflict })
      } else {
        res = await supabase.from(config.table).insert(chunk)
      }
      if (res.error) throw new Error(res.error.message)
    }
  }

  const uniqueFilmCount = new Set(finalInserts.map((r) => r.film_number).filter(Boolean)).size

  const dupesRemoved = inserts.length - finalInserts.length

  return {
    count: finalInserts.length,
    uniqueFilmCount,
    autoGeneratedCount,
    dupesRemoved,
    typeLabel: config.label,
    summaryMessage: config.summaryTemplate(finalInserts.length, uniqueFilmCount, autoGeneratedCount),
  }
}

// ─── Journal / Budget pre-upload helpers ─────────────────────────────────────

function fmtAmount(value) {
  const n = Number(value)
  if (Number.isNaN(n)) return '—'
  return `₪${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function formatUploadDate(isoString) {
  if (!isoString) return 'an unknown date'
  return new Date(isoString).toLocaleDateString(undefined, {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

/**
 * Parse a budget file locally, resolve the film from A2, and check whether
 * a budget already exists in the database — all without writing anything.
 * Returns a preview object the confirmation modal can display.
 */
async function previewBudget(file) {
  const config = TYPE_CONFIG.budgets
  const buf = await file.arrayBuffer()
  const wb  = XLSX.read(buf, { cellDates: true, type: 'array' })
  const ws  = wb.Sheets[wb.SheetNames[0]]

  // Parse rows using the budget template parser (may throw on bad file)
  const rows = config.parseRows(ws)

  // ── Resolve film: A2 may contain a title OR a film_number ──────────────
  const rawId = String(rows[0]?.film_number ?? '').trim()
  let filmNumber   = rawId
  let filmTitle    = rawId
  let studio       = ''
  let profitCenter = ''

  const { data: exactFilm } = await supabase
    .from('films')
    .select('film_number, title_en, title_he, studio, profit_center')
    .eq('film_number', rawId)
    .maybeSingle()

  if (exactFilm) {
    filmTitle    = exactFilm.title_en    || exactFilm.title_he || rawId
    studio       = exactFilm.studio      || ''
    profitCenter = exactFilm.profit_center || ''
  } else {
    const { data: titleFilm } = await supabase
      .from('films')
      .select('film_number, title_en, title_he, studio, profit_center')
      .or(`title_en.ilike.${rawId},title_he.ilike.${rawId}`)
      .maybeSingle()

    if (titleFilm) {
      filmNumber   = titleFilm.film_number
      filmTitle    = titleFilm.title_en || titleFilm.title_he || rawId
      studio       = titleFilm.studio        || ''
      profitCenter = titleFilm.profit_center || ''
      for (const row of rows) row.film_number = filmNumber
    }
  }

  // ── Sum all planned_amount values ───────────────────────────────────────
  const totalAmount = rows.reduce((s, r) => s + (Number(r.planned_amount) || 0), 0)

  // ── Check for an existing budget in the database ────────────────────────
  const { data: existing } = await supabase
    .from('budgets')
    .select('created_at')
    .eq('film_number', filmNumber)
    .order('created_at', { ascending: false })
    .limit(1)

  const existingBudget = existing && existing.length > 0
    ? { exists: true,  latestDate: existing[0].created_at }
    : { exists: false, latestDate: null }

  return { rows, filmNumber, filmTitle, studio, profitCenter, totalAmount, rowCount: rows.length, existingBudget }
}

/**
 * Insert budget rows after user confirms.
 * mode = 'overwrite' → delete existing rows first
 * mode = 'add'       → append
 */
async function executeBudgetUpload(preview, mode) {
  const { rows, filmNumber } = preview

  if (mode === 'overwrite') {
    const { error: delErr } = await supabase
      .from('budgets')
      .delete()
      .eq('film_number', filmNumber)
    if (delErr) throw new Error(`Could not remove previous budget: ${delErr.message}`)
  }

  // Clean rows (strip _row helper field + remove blanks)
  const inserts = rows.map(({ _row, ...data }) => {
    const out = { ...data }
    if (out.film_number != null) out.film_number = String(out.film_number).trim()
    for (const k of Object.keys(out)) {
      if (out[k] == null || (typeof out[k] === 'string' && out[k].trim() === '')) delete out[k]
    }
    return out
  })

  const CHUNK = 500
  for (let i = 0; i < inserts.length; i += CHUNK) {
    const { error } = await supabase.from('budgets').insert(inserts.slice(i, i + CHUNK))
    if (error) throw new Error(error.message)
  }

  return {
    count: inserts.length,
    uniqueFilmCount: 1,
    autoGeneratedCount: 0,
    dupesRemoved: 0,
    typeLabel: 'Budgets',
    summaryMessage: `Successfully ${mode === 'overwrite' ? 'replaced' : 'added'} ${inserts.length} budget line item${inserts.length === 1 ? '' : 's'} for ${preview.filmTitle}.`,
  }
}

// ─── Journal helpers ─────────────────────────────────────────────────────────

const MONTH_NAMES = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
]

/**
 * Parse a journal file, route rows to expenses / income by priority_code,
 * validate film numbers, and check for existing data — no DB writes.
 */
async function previewJournal(file, month, year) {
  const monthPeriod = `${year}-${String(month).padStart(2, '0')}-01`
  const monthLabel  = `${MONTH_NAMES[month - 1]} ${year}`

  // ── Parse file ────────────────────────────────────────────────────────────
  const buf = await file.arrayBuffer()
  const wb  = XLSX.read(buf, { cellDates: true, type: 'array' })
  const ws  = wb.Sheets[wb.SheetNames[0]]
  const allRows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null })

  const rawRows = []
  for (const [i, row] of allRows.entries()) {
    const colC = String(row[2] ?? '').trim()  // priority_code
    const colD = String(row[3] ?? '').trim()  // description (display only)
    // Column E is "מרכז רווח" = Profit Center — NOT film_number directly
    const colE = String(row[4] ?? '').trim()  // profit_center value
    const colF = row[5]                        // amount

    if (!colC || !colE) continue
    if (colC.includes('סה"כ') || colE.includes('סה"כ')) continue

    const amount = parseFloat(String(colF ?? '').replace(/[,\s₪$]/g, ''))
    if (Number.isNaN(amount) || amount === 0) continue

    rawRows.push({ rowNum: i + 1, priority_code: colC, description: colD, profit_center: colE, actual_amount: amount })
  }

  if (rawRows.length === 0) {
    throw new Error(
      'No valid data rows found.\nMake sure columns C (חשבון), E (מרכז רווח), and F (סכום) are populated.',
    )
  }

  // ── Batch catalog lookups ─────────────────────────────────────────────────
  const uniqueCodes        = [...new Set(rawRows.map((r) => r.priority_code))]
  const uniqueProfitCenters = [...new Set(rawRows.map((r) => r.profit_center))]

  // Column E holds profit_center values — resolve to film_number via the films table
  const [expRes, rentRes, filmRes] = await Promise.all([
    supabase.from('expenses').select('priority_code').in('priority_code', uniqueCodes),
    supabase.from('rentals').select('priority_code').in('priority_code', uniqueCodes),
    supabase.from('films').select('film_number, profit_center').in('profit_center', uniqueProfitCenters),
  ])

  const expCodeSet  = new Set((expRes.data  ?? []).map((r) => r.priority_code))
  const rentCodeSet = new Set((rentRes.data ?? []).map((r) => r.priority_code))

  // Map profit_center → film_number (stringify both sides for safe comparison)
  const pcToFilm = new Map(
    (filmRes.data ?? []).map((r) => [String(r.profit_center), r.film_number]),
  )

  // ── Route rows ────────────────────────────────────────────────────────────
  const expenseRows  = []
  const incomeRows   = []
  const unknownCodes = new Set()
  const unknownFilms = new Set()   // profit_centers we couldn't resolve
  const resolvedFilms = new Set()  // for uniqueFilms count

  for (const row of rawRows) {
    const filmNumber = pcToFilm.get(String(row.profit_center))

    if (!filmNumber) {
      unknownFilms.add(row.profit_center)
      // Skip — inserting an unresolved profit_center as film_number would violate FK constraints
      continue
    }

    resolvedFilms.add(filmNumber)

    const PRINT_PREFIXES = ['950', '940', '930']
    const isPrint = PRINT_PREFIXES.some((p) => String(row.priority_code).startsWith(p))

    const baseEntry = {
      film_number:   filmNumber,
      priority_code: row.priority_code,
      actual_amount: row.actual_amount,
      month_period:  monthPeriod,
    }

    if (expCodeSet.has(row.priority_code)) {
      // is_print only exists on actual_expenses, not rental_transactions
      expenseRows.push({ ...baseEntry, is_print: isPrint })
    } else if (rentCodeSet.has(row.priority_code)) {
      incomeRows.push(baseEntry)
    } else {
      unknownCodes.add(row.priority_code)
    }
  }

  // ── Check for existing data this period ───────────────────────────────────
  const [existExpRes, existIncRes] = await Promise.allSettled([
    supabase.from('actual_expenses')     .select('film_number', { count: 'exact', head: true }).eq('month_period', monthPeriod),
    supabase.from('rental_transactions') .select('film_number', { count: 'exact', head: true }).eq('month_period', monthPeriod),
  ])

  const hasExistingData =
    (existExpRes.status === 'fulfilled' && (existExpRes.value.count ?? 0) > 0) ||
    (existIncRes.status === 'fulfilled' && (existIncRes.value.count ?? 0) > 0)

  return {
    expenseRows,
    incomeRows,
    unknownCodes: [...unknownCodes],
    unknownFilms: [...unknownFilms],    // these are profit_center values that had no matching film
    uniqueFilms:  [...resolvedFilms],
    monthPeriod,
    monthLabel,
    hasExistingData,
  }
}

/**
 * Commit the journal to the database.
 * mode = 'overwrite' → wipe existing rows for this period first
 * mode = 'add'       → append
 */
async function executeJournalUpload(preview, mode) {
  const { expenseRows, incomeRows, monthPeriod } = preview

  console.log('[Journal] Starting upload — mode:', mode, '| period:', monthPeriod)
  console.log('[Journal] expenseRows sample:', expenseRows.slice(0, 3))
  console.log('[Journal] incomeRows  sample:', incomeRows.slice(0, 3))

  if (mode === 'overwrite') {
    const [delExp, delInc] = await Promise.all([
      supabase.from('actual_expenses')     .delete().eq('month_period', monthPeriod),
      supabase.from('rental_transactions') .delete().eq('month_period', monthPeriod),
    ])
    if (delExp.error) console.warn('[Journal] Delete actual_expenses error:', delExp.error)
    if (delInc.error) console.warn('[Journal] Delete rental_transactions error:', delInc.error)
  }

  const CHUNK = 500

  for (let i = 0; i < expenseRows.length; i += CHUNK) {
    const chunk = expenseRows.slice(i, i + CHUNK)
    console.log(`[Journal] Inserting actual_expenses chunk ${i}–${i + chunk.length}`)
    const { error, data } = await supabase.from('actual_expenses').insert(chunk).select()
    if (error) {
      console.error('[Journal] actual_expenses insert error:', error)
      throw new Error(`Expense insert failed: ${error.message}`)
    }
    console.log('[Journal] actual_expenses inserted:', data?.length, 'rows')
  }

  for (let i = 0; i < incomeRows.length; i += CHUNK) {
    const chunk = incomeRows.slice(i, i + CHUNK)
    console.log(`[Journal] Inserting rental_transactions chunk ${i}–${i + chunk.length}`)
    const { error, data } = await supabase.from('rental_transactions').insert(chunk).select()
    if (error) {
      console.error('[Journal] rental_transactions insert error:', error)
      throw new Error(`Income insert failed: ${error.message}`)
    }
    console.log('[Journal] rental_transactions inserted:', data?.length, 'rows')
  }

  const total = expenseRows.length + incomeRows.length
  return {
    count: total,
    uniqueFilmCount: new Set([...expenseRows, ...incomeRows].map((r) => r.film_number)).size,
    autoGeneratedCount: 0,
    dupesRemoved: 0,
    typeLabel: 'Journal',
    summaryMessage: `Imported ${expenseRows.length} expense row${expenseRows.length !== 1 ? 's' : ''} and ${incomeRows.length} income row${incomeRows.length !== 1 ? 's' : ''} for ${preview.monthLabel}.`,
  }
}

// ─── Components ──────────────────────────────────────────────────────────────

/** Trigger button — drop into any toolbar */
export function ExcelUploadButton({ onUploadSuccess, disabled = false, initialType, label, className, contextFilm, lockType = false }) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(true)}
        className={className ?? "inline-flex items-center gap-1.5 rounded-xl bg-[#F9B233] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#4B4594] shadow-[0_10px_22px_rgba(249,178,51,0.35)] transition hover:bg-[#fbc050] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#4B4594]/50 disabled:opacity-60"}
        title="Import Excel file"
      >
        <Upload className="h-3 w-3" aria-hidden />
        {label ?? 'Import'}
      </button>

      {open && (
        <ExcelUploadModal
          initialType={initialType}
          contextFilm={contextFilm}
          lockType={lockType}
          onClose={(result) => {
            if (result) onUploadSuccess?.(result)
            setOpen(false)
          }}
          onSuccess={(result) => {
            onUploadSuccess?.(result)
            setOpen(false)
          }}
        />
      )}
    </>
  )
}

function ExcelUploadModal({ onClose, onSuccess, initialType, contextFilm, lockType = false }) {
  const [uploadType, setUploadType] = useState(initialType ?? 'films')
  const [file, setFile]             = useState(null)
  const [busy, setBusy]             = useState(false)
  const [feedback, setFeedback]     = useState(null)
  const [dragOver, setDragOver]     = useState(false)
  const [showGuide, setShowGuide]   = useState(false)
  const [step, setStep]             = useState('select')   // 'select' | 'confirm'
  const [preview, setPreview]       = useState(null)
  const [journalMonth, setJournalMonth] = useState(new Date().getMonth() + 1)
  const [journalYear,  setJournalYear]  = useState(new Date().getFullYear())
  const [journalStudio, setJournalStudio] = useState('')
  const [studioOptions, setStudioOptions] = useState([])
  const fileInputRef = useRef(null)

  // Fixed studio list — same as the Add New Movie form
  const STUDIO_OPTIONS = ['Universal', 'Paramount', 'Warner Bros.', 'Independent']

  useEffect(() => {
    if (uploadType !== 'journal') return
    setStudioOptions(STUDIO_OPTIONS)
    if (!journalStudio) setJournalStudio(STUDIO_OPTIONS[0])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uploadType])

  const config = TYPE_CONFIG[uploadType]

  // ── handlers ──────────────────────────────────────────────────────────────

  function handleTypeChange(key) {
    setUploadType(key)
    setFile(null)
    setFeedback(null)
    setStep('select')
    setPreview(null)
    if (key !== 'journal') setJournalStudio('')
  }

  function acceptFile(f) {
    if (!f) return
    const ext = f.name.split('.').pop().toLowerCase()
    if (!['xlsx', 'xls'].includes(ext)) {
      setFeedback({ type: 'error', message: 'Please choose an .xlsx or .xls file.' })
      return
    }
    setFile(f)
    setFeedback(null)
  }

  function handleInputChange(e) {
    acceptFile(e.target.files?.[0])
    e.target.value = ''
  }

  function handleDrop(e) {
    e.preventDefault()
    setDragOver(false)
    acceptFile(e.dataTransfer.files?.[0])
  }

  async function handleUpload() {
    if (!file || busy) return
    setBusy(true)
    setFeedback(null)
    try {
      if (uploadType === 'budgets') {
        const previewData = await previewBudget(file)

        // Cross-movie guard: when opened from a specific movie's budget card,
        // make sure the file belongs to that movie.
        if (contextFilm) {
          const fileFilmNum = String(previewData.filmNumber ?? '').trim().toLowerCase()
          const ctxFilmNum  = String(contextFilm.film_number ?? '').trim().toLowerCase()
          const ctxTitleEn  = String(contextFilm.title_en ?? '').trim().toLowerCase()
          const ctxTitleHe  = String(contextFilm.title_he ?? '').trim().toLowerCase()
          const fileTitle   = String(previewData.filmTitle  ?? '').trim().toLowerCase()

          const filmNumMatch  = fileFilmNum === ctxFilmNum
          const titleMatch    = fileTitle && (fileTitle === ctxTitleEn || fileTitle === ctxTitleHe)

          if (!filmNumMatch && !titleMatch) {
            const ctxLabel  = contextFilm.title_en || contextFilm.title_he || contextFilm.film_number
            const fileLabel = previewData.filmTitle || previewData.filmNumber || 'unknown'
            throw new Error(
              `Wrong file: this budget belongs to "${fileLabel}" but you opened the budget card for "${ctxLabel}".\n\nPlease upload the correct budget file.`
            )
          }
        }

        setPreview(previewData)
        setStep('confirm')
      } else if (uploadType === 'journal') {
        const previewData = await previewJournal(file, journalMonth, journalYear)

        // ── Studio guard ──────────────────────────────────────────────────────
        if (journalStudio && previewData.uniqueFilms.length > 0) {
          const { data: filmRows } = await supabase
            .from('films')
            .select('film_number, title_en, title_he, studio')
            .in('film_number', previewData.uniqueFilms)

          // Normalise: treat legacy 'Other' as 'Independent' for comparison
          const normStudio = (s) => (s === 'Other' ? 'Independent' : s ?? '')
          const selected   = normStudio(journalStudio).toLowerCase()
          const wrongFilms = (filmRows ?? []).filter(
            f => normStudio(f.studio?.trim()).toLowerCase() !== selected
          )

          if (wrongFilms.length > 0) {
            const names = wrongFilms
              .map(f => `"${f.title_en || f.title_he || f.film_number}" (studio: ${normStudio(f.studio) || 'unknown'})`)
              .join('\n')
            throw new Error(
              `Studio mismatch — you selected "${journalStudio}" but the file contains films from a different studio:\n\n${names}\n\nPlease select the correct studio or upload the right file.`
            )
          }
        }

        setPreview(previewData)
        setStep('confirm')
      } else {
        const result = await processUpload(file, uploadType)
        setFeedback({ type: 'success', message: result.summaryMessage, result })
      }
    } catch (err) {
      setFeedback({ type: 'error', message: err.message })
    } finally {
      setBusy(false)
    }
  }

  async function handleConfirmUpload(mode) {
    if (!preview || busy) return
    setBusy(true)
    try {
      const result = uploadType === 'journal'
        ? await executeJournalUpload(preview, mode)
        : await executeBudgetUpload(preview, mode)
      setStep('select')
      setFile(null)
      setPreview(null)
      setFeedback({ type: 'success', message: result.summaryMessage, result })
    } catch (err) {
      setStep('select')
      setPreview(null)
      setFeedback({ type: 'error', message: err.message })
    } finally {
      setBusy(false)
    }
  }

  // ── render ─────────────────────────────────────────────────────────────────

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="presentation"
      onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(feedback?.result) }}
    >
      <div className="absolute inset-0 bg-[#1a1030]/50 backdrop-blur-[2px]" aria-hidden />

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="xl-import-title"
        className="relative z-10 flex max-h-[92dvh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-[rgba(74,20,140,0.2)] bg-white shadow-[0_30px_64px_rgba(74,20,140,0.24)]"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* ── Modal header ─────────────────────────────────────────────────── */}
        <div className="flex shrink-0 items-center justify-between border-b border-[rgba(74,20,140,0.12)] px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-[#F4EFFF] to-[#FFF2E4]">
              <FileSpreadsheet className="h-5 w-5 text-[#4B4594]" aria-hidden />
            </div>
            <div>
              <h2
                id="xl-import-title"
                className="font-['Montserrat',sans-serif] text-sm font-bold leading-tight text-[#4B4594]"
              >
                Excel Import
              </h2>
              <p className="text-[10px] text-[#9A8AB8]">Upload .xlsx files into Supabase</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => onClose(feedback?.result)}
            disabled={busy}
            className="rounded-lg p-1.5 text-[#8A7BAB] transition hover:bg-[#F7F2FF] hover:text-[#4A148C] disabled:opacity-40"
            aria-label="Close"
          >
            <X className="h-5 w-5" aria-hidden />
          </button>
        </div>

        {/* ── Scrollable body ───────────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto overscroll-contain p-6">

          {/* ── Budget confirmation step ──────────────────────────────────────── */}
          {/* ── Budget confirmation ───────────────────────────────────────────── */}
          {step === 'confirm' && preview && uploadType === 'budgets' && (
            <div className="space-y-4">
              <p className="text-[0.6rem] font-semibold uppercase tracking-[0.2em] text-[#8A7BAB]">
                Confirm budget upload
              </p>

              {/* Film summary card */}
              <div className="rounded-xl border border-[rgba(47,163,107,0.35)] bg-[#F0FBF5] p-4">
                <div className="mb-3 flex items-center gap-2">
                  <Film className="h-4 w-4 shrink-0 text-[#2FA36B]" aria-hidden />
                  <span className="font-['Montserrat',sans-serif] font-bold text-[#1a7a4e]">
                    {preview.filmTitle}
                  </span>
                  <span className="rounded-full bg-[#2FA36B]/10 px-2 py-0.5 text-[10px] font-semibold text-[#2FA36B]">
                    {preview.filmNumber}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2 text-center sm:grid-cols-4">
                  <div className="rounded-lg bg-white px-2 py-2 shadow-sm">
                    <p className="text-[0.58rem] font-semibold uppercase tracking-[0.14em] text-[#8A7BAB]">Studio</p>
                    <p className="mt-0.5 text-xs font-semibold text-[#4B4594]">{preview.studio || '—'}</p>
                  </div>
                  <div className="rounded-lg bg-white px-2 py-2 shadow-sm">
                    <p className="text-[0.58rem] font-semibold uppercase tracking-[0.14em] text-[#8A7BAB]">Profit center</p>
                    <p className="mt-0.5 font-['JetBrains_Mono',ui-monospace,monospace] text-xs font-semibold text-[#4B4594]">
                      {preview.profitCenter || '—'}
                    </p>
                  </div>
                  <div className="rounded-lg bg-white px-2 py-2 shadow-sm">
                    <p className="text-[0.58rem] font-semibold uppercase tracking-[0.14em] text-[#8A7BAB]">Total budget</p>
                    <p className="mt-0.5 font-['Montserrat',sans-serif] text-xs font-extrabold text-[#2FA36B]">
                      {fmtAmount(preview.totalAmount)}
                    </p>
                  </div>
                  <div className="rounded-lg bg-white px-2 py-2 shadow-sm">
                    <p className="text-[0.58rem] font-semibold uppercase tracking-[0.14em] text-[#8A7BAB]">Line items</p>
                    <p className="mt-0.5 text-xs font-semibold text-[#4B4594]">{preview.rowCount} rows</p>
                  </div>
                </div>
              </div>

              {preview.existingBudget.exists && (
                <div className="flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" aria-hidden />
                  <div className="text-sm text-amber-800">
                    <p className="font-semibold">Budget already exists</p>
                    <p className="mt-0.5 text-[12px] leading-snug text-amber-700">
                      A budget for this film was already uploaded on{' '}
                      <span className="font-semibold">{formatUploadDate(preview.existingBudget.latestDate)}</span>.
                      Choose how to proceed:
                    </p>
                  </div>
                </div>
              )}

              <div className="flex flex-col gap-2 pt-1">
                {preview.existingBudget.exists && (
                  <button type="button" onClick={() => handleConfirmUpload('overwrite')} disabled={busy}
                    className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#E61E6E] px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#cc1a61] disabled:opacity-50">
                    {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
                    Overwrite existing budget
                  </button>
                )}
                <button type="button" onClick={() => handleConfirmUpload('add')} disabled={busy}
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#2FA36B] px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#28915f] disabled:opacity-50">
                  {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
                  {preview.existingBudget.exists ? 'Add to existing budget' : 'Upload budget'}
                </button>
                <button type="button" onClick={() => { setStep('select'); setPreview(null) }} disabled={busy}
                  className="rounded-xl border border-[rgba(74,20,140,0.2)] bg-white px-4 py-2.5 text-sm font-semibold text-[#4A148C] transition hover:bg-[#F7F2FF] disabled:opacity-50">
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* ── Journal confirmation ──────────────────────────────────────────── */}
          {step === 'confirm' && preview && uploadType === 'journal' && (
            <div className="space-y-4">
              <p className="text-[0.6rem] font-semibold uppercase tracking-[0.2em] text-[#8A7BAB]">
                Review — {preview.monthLabel}
              </p>

              {/* Routing summary */}
              <div className="rounded-xl border border-[rgba(75,69,148,0.3)] bg-[#F4F0FF] p-4">
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-lg bg-white px-2 py-2.5 shadow-sm">
                    <p className="text-[0.58rem] font-semibold uppercase tracking-[0.14em] text-[#8A7BAB]">Expenses</p>
                    <p className="mt-0.5 font-['Montserrat',sans-serif] text-lg font-extrabold text-[#C0392B]">
                      {preview.expenseRows.length}
                    </p>
                    <p className="text-[10px] text-[#8A7BAB]">rows</p>
                  </div>
                  <div className="rounded-lg bg-white px-2 py-2.5 shadow-sm">
                    <p className="text-[0.58rem] font-semibold uppercase tracking-[0.14em] text-[#8A7BAB]">Income</p>
                    <p className="mt-0.5 font-['Montserrat',sans-serif] text-lg font-extrabold text-[#0EA5A0]">
                      {preview.incomeRows.length}
                    </p>
                    <p className="text-[10px] text-[#8A7BAB]">rows</p>
                  </div>
                  <div className="rounded-lg bg-white px-2 py-2.5 shadow-sm">
                    <p className="text-[0.58rem] font-semibold uppercase tracking-[0.14em] text-[#8A7BAB]">Films</p>
                    <p className="mt-0.5 font-['Montserrat',sans-serif] text-lg font-extrabold text-[#4B4594]">
                      {preview.uniqueFilms.length}
                    </p>
                    <p className="text-[10px] text-[#8A7BAB]">unique</p>
                  </div>
                </div>
              </div>

              {/* Warnings — unknown priority codes */}
              {preview.unknownCodes.length > 0 && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
                  <div className="flex items-start gap-2.5">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" aria-hidden />
                    <div>
                      <p className="text-sm font-semibold text-amber-800">
                        {preview.unknownCodes.length} unrecognised priority code{preview.unknownCodes.length !== 1 ? 's' : ''} — rows skipped
                      </p>
                      <p className="mt-1 font-['JetBrains_Mono',ui-monospace,monospace] text-[11px] text-amber-700 break-all">
                        {preview.unknownCodes.join(', ')}
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* Warnings — profit centers with no matching film */}
              {preview.unknownFilms.length > 0 && (
                <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3">
                  <div className="flex items-start gap-2.5">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" aria-hidden />
                    <div>
                      <p className="text-sm font-semibold text-red-800">
                        {preview.unknownFilms.length} profit center{preview.unknownFilms.length !== 1 ? 's' : ''} not found in Films table
                      </p>
                      <p className="mt-0.5 text-[11px] text-red-700">
                        These rows will be inserted with the raw profit center code as the film number. Add these films first for correct linking.
                      </p>
                      <p className="mt-1 font-['JetBrains_Mono',ui-monospace,monospace] text-[11px] text-red-700 break-all">
                        {preview.unknownFilms.join(', ')}
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* Warning — existing data this period */}
              {preview.hasExistingData && (
                <div className="flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" aria-hidden />
                  <div className="text-sm text-amber-800">
                    <p className="font-semibold">Data for {preview.monthLabel} already exists</p>
                    <p className="mt-0.5 text-[12px] leading-snug text-amber-700">
                      Choose <strong>Overwrite</strong> to delete all existing records for this period and re-import, or <strong>Append</strong> to add alongside the existing data.
                    </p>
                  </div>
                </div>
              )}

              {/* No valid rows at all */}
              {preview.expenseRows.length === 0 && preview.incomeRows.length === 0 && (
                <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  No rows could be routed to any table. Check that priority codes in column C exist in the Expenses or Rentals catalogs.
                </div>
              )}

              {/* Action buttons */}
              {(() => {
                const hasRows = preview.expenseRows.length + preview.incomeRows.length > 0
                return (
                  <div className="flex flex-col gap-2 pt-1">
                    {hasRows && preview.hasExistingData && (
                      <button type="button" onClick={() => handleConfirmUpload('overwrite')} disabled={busy}
                        className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#E61E6E] px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#cc1a61] disabled:opacity-50">
                        {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
                        Overwrite {preview.monthLabel}
                      </button>
                    )}
                    {hasRows ? (
                      <button type="button" onClick={() => handleConfirmUpload('add')} disabled={busy}
                        className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#4B4594] px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#3a3477] disabled:opacity-50">
                        {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
                        {preview.hasExistingData ? 'Append to existing' : `Import ${preview.expenseRows.length + preview.incomeRows.length} rows`}
                      </button>
                    ) : (
                      <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                        <p className="font-semibold">Nothing to import</p>
                        <p className="mt-0.5 text-[12px]">
                          No priority codes matched the Expenses or Rentals catalogs.
                          Import your <strong>Expenses</strong> and <strong>Rentals</strong> catalog files first, then retry the journal import.
                        </p>
                      </div>
                    )}
                    <button type="button" onClick={() => { setStep('select'); setPreview(null) }} disabled={busy}
                      className="rounded-xl border border-[rgba(74,20,140,0.2)] bg-white px-4 py-2.5 text-sm font-semibold text-[#4A148C] transition hover:bg-[#F7F2FF] disabled:opacity-50">
                      {hasRows ? 'Cancel' : 'Go back'}
                    </button>
                  </div>
                )
              })()}
            </div>
          )}

          {/* ── Normal select / upload flow ───────────────────────────────────── */}
          {step === 'select' && (
          <>

          {/* Data-type selector */}
          {contextFilm ? (
            /* ── Opened from a specific movie's budget card ── */
            <div className="mb-5 flex items-center gap-3 rounded-xl border border-[rgba(47,163,107,0.3)] bg-[#F0FBF5] px-4 py-3">
              <Film className="h-5 w-5 shrink-0 text-[#2FA36B]" aria-hidden />
              <div className="min-w-0">
                <p className="text-[0.6rem] font-semibold uppercase tracking-[0.18em] text-[#2FA36B]">Budget import for</p>
                <p className="truncate font-['Montserrat',sans-serif] font-bold text-[#1a7a4e]">
                  {contextFilm.title_en || contextFilm.title_he || contextFilm.film_number}
                </p>
                {contextFilm.film_number && (
                  <p className="font-['JetBrains_Mono',ui-monospace,monospace] text-[11px] text-[#2FA36B]">
                    #{contextFilm.film_number}
                    {contextFilm.profit_center ? ` · PC ${contextFilm.profit_center}` : ''}
                  </p>
                )}
              </div>
            </div>
          ) : lockType ? (
            /* ── Locked to a single type (no type switching) ── */
            <div className={`mb-5 flex items-center gap-2.5 rounded-xl px-4 py-2.5 ${
              uploadType === 'journal'
                ? 'border border-[rgba(75,69,148,0.25)] bg-[#F4F0FF]'
                : 'border border-[rgba(47,163,107,0.25)] bg-[#F0FBF5]'
            }`}>
              {uploadType === 'journal'
                ? <Receipt className="h-4 w-4 shrink-0 text-[#4B4594]" aria-hidden />
                : <Receipt className="h-4 w-4 shrink-0 text-[#2FA36B]" aria-hidden />
              }
              <p className={`text-[0.6rem] font-semibold uppercase tracking-[0.18em] ${
                uploadType === 'journal' ? 'text-[#4B4594]' : 'text-[#2FA36B]'
              }`}>
                {uploadType === 'journal' ? 'Monthly expenses / rentals import' : 'Budget import — any movie'}
              </p>
            </div>
          ) : (
            /* ── Full type selector (Admin / other entry points) ── */
            <div className="mb-5">
              <p className="mb-2 text-[0.6rem] font-semibold uppercase tracking-[0.2em] text-[#8A7BAB]">
                Select data type
              </p>
              <div className="grid grid-cols-4 gap-2 sm:grid-cols-7">
                {Object.entries(TYPE_CONFIG).map(([key, cfg]) => {
                  const TabIcon = cfg.icon
                  const active  = uploadType === key
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => handleTypeChange(key)}
                      className={`flex flex-col items-center gap-1.5 rounded-xl border px-2 py-3 text-center transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 ${
                        active
                          ? `${cfg.bgColor} ${cfg.borderColor} shadow-sm`
                          : 'border-[rgba(74,20,140,0.14)] bg-white hover:bg-[#F7F2FF]'
                      }`}
                    >
                      <TabIcon
                        className="h-4 w-4 shrink-0"
                        style={{ color: active ? cfg.color : '#9A8AB8' }}
                        aria-hidden
                      />
                      <span
                        className="text-[10px] font-semibold uppercase tracking-[0.12em]"
                        style={{ color: active ? cfg.color : '#6A5B88' }}
                      >
                        {cfg.label}
                      </span>
                    </button>
                  )
                })}
              </div>
              <p className="mt-2 text-[11px] leading-snug text-[#7C6D98]">{config.description}</p>
            </div>
          )}

          {/* ── Month / Year selectors (Journal only) ──────────────────────── */}
          {uploadType === 'journal' && (
            <div className="mb-5 rounded-xl border border-[rgba(75,69,148,0.3)] bg-[#F4F0FF] p-4">
              <p className="mb-3 text-[0.6rem] font-semibold uppercase tracking-[0.2em] text-[#4B4594]">
                Select period &amp; studio
              </p>
              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="mb-1 block text-[11px] font-semibold text-[#6B5FA8]">Month</label>
                  <select
                    value={journalMonth}
                    onChange={(e) => setJournalMonth(Number(e.target.value))}
                    className="w-full rounded-lg border border-[rgba(75,69,148,0.3)] bg-white px-3 py-2 text-sm font-medium text-[#4B4594] focus:outline-none focus:ring-2 focus:ring-[#4B4594]/30"
                  >
                    {MONTH_NAMES.map((name, i) => (
                      <option key={i + 1} value={i + 1}>{name}</option>
                    ))}
                  </select>
                </div>
                <div className="w-28">
                  <label className="mb-1 block text-[11px] font-semibold text-[#6B5FA8]">Year</label>
                  <select
                    value={journalYear}
                    onChange={(e) => setJournalYear(Number(e.target.value))}
                    className="w-full rounded-lg border border-[rgba(75,69,148,0.3)] bg-white px-3 py-2 text-sm font-medium text-[#4B4594] focus:outline-none focus:ring-2 focus:ring-[#4B4594]/30"
                  >
                    {[2024, 2025, 2026, 2027, 2028].map((y) => (
                      <option key={y} value={y}>{y}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Studio selector */}
              <div className="mt-3">
                <label className="mb-1 block text-[11px] font-semibold text-[#6B5FA8]">
                  Studio
                  <span className="ml-1 font-normal text-[#9A8AB8]">(file must only contain films from this studio)</span>
                </label>
                {studioOptions.length > 0 ? (
                  <select
                    value={journalStudio}
                    onChange={(e) => setJournalStudio(e.target.value)}
                    className="w-full rounded-lg border border-[rgba(75,69,148,0.3)] bg-white px-3 py-2 text-sm font-medium text-[#4B4594] focus:outline-none focus:ring-2 focus:ring-[#4B4594]/30"
                  >
                    {studioOptions.map(s => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                ) : (
                  <p className="text-[11px] text-[#9A8AB8]">Loading studios…</p>
                )}
              </div>
            </div>
          )}

          {/* ── Success card ─────────────────────────────────────────────────── */}
          {feedback?.type === 'success' ? (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4" role="status">
              <div className="flex items-start gap-3">
                <CheckCircle className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="font-semibold leading-snug text-emerald-800">
                    {feedback.message}
                  </p>
                  <div className="mt-2.5 flex flex-wrap gap-2">
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-0.5 text-[11px] font-semibold tabular-nums text-emerald-700">
                      {feedback.result.count} rows imported
                    </span>
                    {feedback.result.uniqueFilmCount > 0 && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-0.5 text-[11px] font-semibold tabular-nums text-emerald-700">
                        {feedback.result.uniqueFilmCount} unique film{feedback.result.uniqueFilmCount === 1 ? '' : 's'}
                      </span>
                    )}
                    {feedback.result.autoGeneratedCount > 0 && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-0.5 text-[11px] font-semibold tabular-nums text-amber-700">
                        {feedback.result.autoGeneratedCount} ID{feedback.result.autoGeneratedCount === 1 ? '' : 's'} auto-generated
                      </span>
                    )}
                    {feedback.result.dupesRemoved > 0 && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-semibold tabular-nums text-slate-600">
                        {feedback.result.dupesRemoved} duplicate{feedback.result.dupesRemoved === 1 ? '' : 's'} skipped
                      </span>
                    )}
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-700">
                      {feedback.result.typeLabel} table
                    </span>
                  </div>
                </div>
              </div>
              <div className="mt-4 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => { setFeedback(null); setFile(null) }}
                  className="rounded-xl border border-[rgba(74,20,140,0.2)] bg-white px-3 py-2 text-xs font-semibold text-[#4A148C] transition hover:bg-[#F7F2FF]"
                >
                  Import more
                </button>
                <button
                  type="button"
                  onClick={() => onSuccess?.(feedback.result)}
                  className="rounded-xl bg-[#4B4594] px-4 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-[#5a529f]"
                >
                  Done
                </button>
              </div>
            </div>
          ) : (
            <>
              {/* ── Drop zone ───────────────────────────────────────────────── */}
              <div
                role="button"
                tabIndex={0}
                aria-label="Choose or drop an Excel file"
                onClick={() => fileInputRef.current?.click()}
                onKeyDown={(e) => e.key === 'Enter' && fileInputRef.current?.click()}
                onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleDrop}
                className={`mb-4 flex cursor-pointer flex-col items-center justify-center gap-2.5 rounded-xl border-2 border-dashed py-8 transition ${
                  dragOver
                    ? 'border-[#4B4594] bg-[#EDE9FF]'
                    : file
                    ? 'border-emerald-300 bg-emerald-50/80'
                    : 'border-[rgba(74,20,140,0.22)] bg-[#FAFAFE] hover:border-[#4B4594] hover:bg-[#F5F2FF]'
                }`}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
                  className="sr-only"
                  onChange={handleInputChange}
                  aria-label="Excel file"
                />
                {file ? (
                  <>
                    <FileSpreadsheet className="h-9 w-9 text-emerald-500" aria-hidden />
                    <div className="text-center">
                      <p className="max-w-[18rem] truncate text-sm font-semibold text-emerald-700">
                        {file.name}
                      </p>
                      <p className="text-[11px] text-emerald-600">
                        {(file.size / 1024).toFixed(1)} KB · click to change
                      </p>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-[rgba(74,20,140,0.14)] bg-white shadow-sm">
                      <Upload className="h-5 w-5 text-[#7B52AB]" aria-hidden />
                    </div>
                    <div className="text-center">
                      <p className="text-sm font-medium text-[#5B4B7A]">
                        Drop your{' '}
                        <span className="font-bold text-[#4B4594]">.xlsx</span> file here
                      </p>
                      <p className="text-[11px] text-[#9A8AB8]">or click to browse</p>
                    </div>
                  </>
                )}
              </div>

              {/* Error panel */}
              {feedback?.type === 'error' && (
                <div
                  className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3"
                  role="alert"
                >
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" aria-hidden />
                    <pre className="min-w-0 flex-1 whitespace-pre-wrap break-words font-sans text-xs leading-relaxed text-red-700">
                      {feedback.message}
                    </pre>
                  </div>
                </div>
              )}

              {/* Column mapping guide — collapsed by default, below the drop zone */}
              <div className="mt-2 overflow-hidden rounded-xl border border-[rgba(74,20,140,0.12)] bg-[#F7F4FC]">
                <button
                  type="button"
                  onClick={() => setShowGuide((v) => !v)}
                  className="flex w-full items-center justify-between px-3.5 py-2.5 text-left"
                >
                  <span className="flex items-center gap-1.5 text-[0.6rem] font-semibold uppercase tracking-[0.16em] text-[#4A148C]">
                    <TableProperties className="h-3.5 w-3.5" aria-hidden />
                    Column mapping guide
                  </span>
                  {showGuide
                    ? <ChevronUp   className="h-3.5 w-3.5 text-[#8A7BAB]" aria-hidden />
                    : <ChevronDown className="h-3.5 w-3.5 text-[#8A7BAB]" aria-hidden />
                  }
                </button>

                {showGuide && (
                  <div className="border-t border-[rgba(74,20,140,0.08)] px-3.5 pb-4 pt-3">
                    <p className="mb-2 text-[10px] text-[#7C6D98]">
                      Excel column headers map to Supabase columns:
                    </p>
                    <div className="overflow-hidden rounded-lg border border-[rgba(74,20,140,0.1)] bg-white text-[10px]">
                      <table className="w-full border-collapse">
                        <thead>
                          <tr className="border-b border-[rgba(74,20,140,0.08)] bg-[#F4F0FF]">
                            <th className="px-2.5 py-1.5 text-left font-semibold text-[#4A148C]">Excel header</th>
                            <th className="px-2.5 py-1.5 text-left font-semibold text-[#4A148C]">→ DB column</th>
                            <th className="hidden px-2.5 py-1.5 text-left font-medium text-[#8A7BAB] sm:table-cell">Note</th>
                          </tr>
                        </thead>
                        <tbody>
                          {config.mappingTable.map(([excel, db, note]) => (
                            <tr key={db} className="border-b border-[rgba(74,20,140,0.06)] last:border-0">
                              <td className="px-2.5 py-1.5 font-['JetBrains_Mono',ui-monospace,monospace] text-[#4B4594]">{excel}</td>
                              <td className="px-2.5 py-1.5 font-['JetBrains_Mono',ui-monospace,monospace] text-[#2FA36B]">{db}</td>
                              <td className="hidden px-2.5 py-1.5 text-[#9A8AB8] sm:table-cell">{note}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <p className="mb-1 mt-3 text-[10px] text-[#7C6D98]">Example spreadsheet layout:</p>
                    <pre className="overflow-x-auto whitespace-pre rounded-lg bg-white px-2.5 py-2 font-['JetBrains_Mono',ui-monospace,monospace] text-[10px] leading-snug text-[#4B4594] ring-1 ring-[rgba(74,20,140,0.1)]">
                      {config.exampleHeaders}
                    </pre>
                    <pre className="mt-1 overflow-x-auto whitespace-pre rounded-lg bg-[#FFFBF0] px-2.5 py-2 font-['JetBrains_Mono',ui-monospace,monospace] text-[10px] leading-snug text-[#5B4B7A] ring-1 ring-[rgba(249,178,51,0.2)]">
                      {config.exampleRow}
                    </pre>
                    {config.requiresFilmCheck && (
                      <p className="mt-2.5 flex items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-2.5 py-1.5 text-[10px] leading-relaxed text-red-700">
                        <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden />
                        Film numbers must already exist in the <strong>Films</strong> table. Import Films first.
                      </p>
                    )}
                  </div>
                )}
              </div>
            </>
          )}
          </>
          )}

        </div>

        {/* ── Footer actions (hidden during confirm step and after success) ─── */}
        {feedback?.type !== 'success' && step !== 'confirm' && (
          <div className="flex shrink-0 justify-end gap-2 border-t border-[rgba(74,20,140,0.1)] bg-white px-6 py-4">
            <button
              type="button"
              onClick={() => onClose(feedback?.result)}
              disabled={busy}
              className="rounded-xl border border-[rgba(74,20,140,0.2)] bg-white px-4 py-2.5 text-sm font-semibold text-[#4A148C] transition hover:bg-[#F7F2FF] disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleUpload}
              disabled={!file || busy}
              className="inline-flex min-w-[9rem] items-center justify-center gap-2 rounded-xl bg-[#F9B233] px-5 py-2.5 text-sm font-semibold text-[#4B4594] shadow-[0_8px_18px_rgba(249,178,51,0.3)] transition hover:bg-[#fbc050] disabled:opacity-50"
            >
              {busy ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                  Importing…
                </>
              ) : (
                <>
                  <Upload className="h-4 w-4" aria-hidden />
                  Import {config.label}
                </>
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
