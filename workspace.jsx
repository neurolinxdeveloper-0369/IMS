import React, { useEffect, useState } from 'react'
import { canRead, canWrite, planBomLine, projectCatalogItems, roles, sections, wholeProductionUnits } from './inventory-shared.mjs'
import { bomHeaderIndex, bomSkuColumn, bomWorkbookColumns, excelRequiredAmount, excelStockQuantity, joinBomPlanningRows, parseBomWorkbookSheet, requiredBomAmount } from './bom-workbook.mjs'
import './workspace.css'

const groups = {
  Workspace: [['overview', 'Overview']],
  Purchasing: [['vendors', 'Vendors'], ['quotations', 'Quotations'], ['orders', 'Purchase orders'], ['receipts', 'Goods receipts (GRN)'], ['invoices', 'Purchase invoices']],
  Inventory: [['items', 'Items'], ['stock', 'Stock on hand'], ['openings', 'Opening stock'], ['issues', 'Stock issues'], ['closings', 'Closing stock']],
  Projects: [['projects', 'Projects'], ['boms', 'Bills of materials']],
  Administration: [['users', 'Team accounts'], ['audit', 'Activity log'], ['password', 'Change password']],
}

const navigationIcons = {
  overview: 'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',
  vendors: 'M3 21h18 M5 21V7l7-4 7 4v14 M9 11h6 M9 15h6',
  quotations: 'M5 3h10l4 4v14H5z M8 10h8 M8 14h8 M8 18h5',
  orders: 'M7 7H3v14h18V7h-4 M7 4h10v6H7z M7 14h10 M7 17h7',
  receipts: 'M3 8h18v13H3z M3 8l3-5h12l3 5 M8 14l3 3 5-5',
  invoices: 'M5 3h14v18l-3-2-4 2-4-2-3 2z M8 8h8 M8 12h8 M8 16h5',
  items: 'M3 7l9-4 9 4v10l-9 4-9-4z M3 7l9 4 9-4 M12 11v10',
  stock: 'M3 3h18v18H3z M7 16v-4 M12 16V8 M17 16V6',
  openings: 'M3 12h12 M11 8l4 4-4 4 M17 4h4v16h-4',
  issues: 'M9 12h12 M17 8l4 4-4 4 M7 4H3v16h4',
  closings: 'M5 9h14v12H5z M8 9V7a4 4 0 0 1 8 0v2 M12 13v4',
  projects: 'M3 6h7l2 2h9v12H3z',
  boms: 'M12 3v5 M5 13V8h14v5 M3 13h4v5H3z M17 13h4v5h-4z M10 3h4',
  users: 'M8 21v-3a4 4 0 0 1 4-4h2a4 4 0 0 1 4 4v3 M13 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8 M3 21v-3a4 4 0 0 1 3-4',
  audit: 'M4 3h16v18H4z M8 8h8 M8 12h8 M8 16h6',
  password: 'M3 15a5 5 0 1 0 7 4l8-8h3V8h-3l-8 8 M6 18h.01',
}

const stockColumns = [['code', 'SKU'], ['name', 'Item'], ['unit', 'Unit'], ['quantity', 'On hand'], ['minimum', 'Reorder level']]
const auditColumns = [['date', 'Date'], ['actor', 'User ID'], ['action', 'Action'], ['reference', 'Reference']]
const emptyLine = { item: '', quantity: '', price: '' }
const editable = ['items', 'vendors', 'projects']

async function api(path, body) {
  const response = await fetch('/IMS/api/' + path, body === undefined ? undefined : {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const result = await response.json().catch(() => ({}))
  if (!response.ok) {
    const error = new Error(result.message || 'The request could not be completed.')
    error.status = response.status
    throw error
  }
  return result
}

function shortDate(value) {
  return new Date(value).toLocaleString()
}

function labelFor(record) {
  return record?.name ? record.code + ' · ' + record.name : record?.number
}

function formatCell(key, value, row, data, page) {
  if (key === 'source') {
    return labelFor(data?.records[sections[page]?.fields.find(([field]) => field === key)?.[2]]?.find((record) => record.id === value)) ?? value
  }
  if (key === 'project' || key === 'vendor') {
    return labelFor(data?.records[key + 's']?.find((record) => record.id === value)) ?? value
  }
  if (key === 'role') return roles[value]
  if (key === 'date' && page === 'audit') return shortDate(value)
  if (key === 'mustChangePassword') return value ? 'Password change required' : 'Active'
  if (key === 'quantity' && page === 'stock' && Number(value) <= Number(row.minimum)) {
    return <span className="ims-low">{value} · Reorder</span>
  }
  return value ?? '—'
}

function groupTableRows(rows, groupBy) {
  const rowGroups = new Map()
  for (const row of rows) {
    const group = groupBy?.(row) ?? ''
    if (!rowGroups.has(group)) rowGroups.set(group, [])
    rowGroups.get(group).push(row)
  }
  return rowGroups
}

function Table({ rows, columns, renderCell = (key, row) => row[key], rowClassName, groupBy, action, scrollLabel, footer, empty = 'No records yet.' }) {
  if (!rows.length) return <p className="ims-empty">{empty}</p>
  const rowGroups = groupTableRows(rows, groupBy)
  return (
    <div className="ims-table-wrap" tabIndex={scrollLabel ? 0 : undefined}
      role={scrollLabel ? 'region' : undefined} aria-label={scrollLabel}>
      <table>
        <thead><tr>{columns.map(([key, label]) => <th key={key} scope="col">{label}</th>)}{action && <th scope="col">Actions</th>}</tr></thead>
        {[...rowGroups].map(([group, members]) => (
          <tbody key={group}>
            {group && <tr><th className="ims-table-group-heading" scope="rowgroup" colSpan={columns.length + (action ? 1 : 0)}>
              <span>{group}</span>
            </th></tr>}
            {members.map((row) => (
              <tr key={row.id ?? row.userId} className={rowClassName?.(row)}>
                {columns.map(([key]) => <td key={key}>{renderCell(key, row)}</td>)}
                {action && <td>{action(row)}</td>}
              </tr>
            ))}
          </tbody>
        ))}
        {footer && <tfoot><tr>
          <th scope="row" colSpan={columns.length - 1}><span>{footer.label}</span></th>
          <td>{footer.value}</td>
        </tr></tfoot>}
      </table>
    </div>
  )
}

const stockNumber = new Intl.NumberFormat('en-IN')

function formatStockThousandths(value) {
  if (value === null) return '—'
  const absolute = value < 0n ? -value : value
  const fraction = (absolute % 1000n).toString().padStart(3, '0').replace(/0+$/, '')
  return (value < 0n ? '−' : '') + stockNumber.format(absolute / 1000n) + (fraction ? '.' + fraction : '')
}

function formatRequiredAmount(cents) {
  return cents === null ? '—' : '₹' + stockNumber.format(cents / 100n) + '.' + (cents % 100n).toString().padStart(2, '0')
}

function BomStockPlan({ reference, project, lines, balances, sourceRows, showPrice }) {
  const [production, setProduction] = useState('1')
  const [bomBasis, setBomBasis] = useState('1')
  const [downloading, setDownloading] = useState(false)
  const [downloadError, setDownloadError] = useState('')
  const productionUnits = wholeProductionUnits(production)
  const bomUnits = wholeProductionUnits(bomBasis)
  const stockByItem = new Map(balances.map((item) => [String(item.id), item]))
  const rows = joinBomPlanningRows(lines, sourceRows).map(({ id, line, sourceRows }) => {
    const item = stockByItem.get(String(line?.item))
    const quantity = line?.quantity ?? sourceRows[0]?.quantity
    const plan = planBomLine(quantity, item?.quantity, productionUnits, bomUnits)
    return {
      id,
      sourceRows,
      category: sourceRows.find((source) => source.category)?.category.replace(/^\d+[.)]\s*/, '').trim(),
      sku: item?.code ?? sourceRows[0]?.sku ?? '—',
      name: item?.name ?? '—',
      quantity,
      zeroQuantity: quantity === 0,
      ...plan,
      requiredAmount: showPrice ? requiredBomAmount(plan.shortage, sourceRows) : null,
    }
  })
  const shortCount = rows.filter((row) => row.shortage > 0n).length
  const valid = productionUnits !== null && bomUnits !== null
  const incomplete = valid && rows.some((row) => Number(row.quantity) > 0 && row.requiredAmount === null)
  const grandTotal = valid ? rows.reduce((total, row) => total + (row.requiredAmount ?? 0n), 0n) : null
  const totalLabel = incomplete ? 'Grand total (priced shortfalls only)' : 'Grand total'
  const hasWorkbook = Boolean(sourceRows?.length)
  const hasCategories = rows.some((row) => row.category)
  const groupBy = hasCategories ? (row) => row.category?.toUpperCase() || 'UNCATEGORIZED' : undefined
  const hasGroupedRows = rows.some((row) => row.sourceRows.length > 1)
  const workbookColumns = hasWorkbook ? bomWorkbookColumns
    .filter(([key]) => key !== 'quantity' && (showPrice || key !== 'unitPrice')) : []
  const columns = [
    ...workbookColumns.map(([key, label]) => ['source-' + key, label]),
    ...(hasGroupedRows ? [['source-quantity', 'Workbook qty / card']] : []),
    ['sku', 'SKU'], ['name', 'Item'],
    ['quantity', bomUnits === 1n ? (hasWorkbook ? 'Qty / Card' : 'Qty / unit') : 'BOM quantity'],
    ['stock', 'Current stock'], ['total', 'Total needed'],
    ['shortage', 'Required (shortfall)'], ['balance', 'Stock balance'],
    ...(showPrice ? [['requiredAmount', 'Required Amount (INR)']] : []),
  ]

  async function downloadExcel() {
    if (!valid || downloading) return
    setDownloading(true)
    setDownloadError('')
    try {
      const { downloadBomExcel } = await import('./bom-excel.mjs')
      const exportRows = []
      for (const [heading, members] of groupTableRows(rows, groupBy)) {
        if (heading) exportRows.push({ heading })
        for (const row of members) {
          const cells = columns.map(([key]) => {
            if (key.startsWith('source-')) {
              const field = key.slice(7)
              const values = row.sourceRows.map((source) => source[field])
              if (values.every((value) => value == null || value === '')) return null
              return values.length === 1 ? values[0] : values.map((value) => formatWorkbookCell(field, value)).join('\n')
            }
            const value = row[key]
            if (key === 'requiredAmount') return excelRequiredAmount(value)
            return typeof value === 'bigint' ? excelStockQuantity(value) : value === '—' ? null : value ?? null
          })
          exportRows.push({ cells, shortage: row.shortage > 0n, zeroQuantity: row.zeroQuantity })
        }
      }
      await downloadBomExcel({
        reference, project, production: Number(productionUnits), bomBasis: Number(bomUnits), columns, rows: exportRows,
        totals: showPrice ? { label: totalLabel, amount: excelRequiredAmount(grandTotal) } : undefined,
      })
    } catch {
      setDownloadError('The Excel file could not be generated. Try the download again.')
    } finally {
      setDownloading(false)
    }
  }

  return (
    <section className={hasWorkbook ? 'ims-bom-plan ims-bom-plan-imported' : 'ims-bom-plan'} aria-label="BOM stock plan">
      <div className="ims-bom-plan-controls">
        <label className="ims-field"><span>Production quantity</span>
          <input type="text" inputMode="numeric" maxLength={9} value={production} aria-invalid={productionUnits === null}
            onChange={(event) => setProduction(event.target.value)} />
        </label>
        <label className="ims-field"><span>Units covered by this BOM</span>
          <input type="text" inputMode="numeric" maxLength={9} value={bomBasis} aria-invalid={bomUnits === null}
            onChange={(event) => setBomBasis(event.target.value)} />
        </label>
        <button className="ims-button ims-bom-download" type="button" onClick={downloadExcel} disabled={!valid || downloading}>
          {downloading ? 'Preparing Excel…' : 'Download Excel'}
        </button>
      </div>
      <p className="ims-bom-plan-note">Use 1 for a per-unit BOM. For a BOM already entered as a batch, enter the number of units it covers.</p>
      <p className="ims-bom-plan-status" role="status">
        {!valid ? 'Enter positive whole numbers for both quantities.'
          : shortCount ? `${shortCount} of ${lines.length} items short for this run.` : 'No shortages in known stock.'}
      </p>
      {showPrice && incomplete && <p className="ims-bom-plan-note">Rows with unavailable stock or a missing or conflicting unit price are excluded from the total.</p>}
      {downloadError && <p className="ims-error" role="alert">{downloadError}</p>}
      <Table rows={rows} columns={columns} scrollLabel="BOM details table"
        rowClassName={(row) => row.zeroQuantity ? 'ims-bom-zero' : row.shortage > 0n ? 'ims-bom-shortage' : undefined}
        footer={showPrice ? { label: totalLabel, value: formatRequiredAmount(grandTotal) } : undefined}
        groupBy={groupBy}
        renderCell={(key, row) => {
          if (key.startsWith('source-')) {
            const field = key.slice(7)
            return row.sourceRows.length
              ? row.sourceRows.map((source, index) => <div key={index}>{formatWorkbookCell(field, source[field])}</div>)
              : '—'
          }
          if (key === 'requiredAmount') return formatRequiredAmount(row.requiredAmount)
          return typeof row[key] === 'bigint' || row[key] === null ? formatStockThousandths(row[key]) : row[key] ?? '—'
        }} />
    </section>
  )
}

function formatWorkbookCell(key, value) {
  if (value === '' || value == null) return '—'
  return key === 'unitPrice' && Number.isFinite(Number(value)) ? Number(value).toFixed(2) : value
}

function BomWorkbookTable({ rows, showSku = false }) {
  const columns = showSku ? [...bomWorkbookColumns, bomSkuColumn] : bomWorkbookColumns
  return <Table rows={rows} columns={columns}
    renderCell={(key, row) => formatWorkbookCell(key, row[key])} />
}

function Field({ field, data, value, onChange }) {
  const [name, label, type = 'text', optional] = field
  let options = data?.records[type]
  if (name === 'source' && type === 'quotations') options = options?.filter((row) => row.status !== 'Ordered')
  if (name === 'source' && type === 'orders') options = options?.filter((row) => row.status !== 'Received')
  if (name === 'source' && type === 'receipts') options = options?.filter((row) => !row.invoiced)
  return (
    <label className="ims-field">
      <span>{label}{optional && <small> optional</small>}</span>
      {options ? (
        <select name={name} required={!optional} {...(onChange ? { value, onChange } : { defaultValue: value ?? '' })}>
          <option value="">Select {label.toLowerCase()}</option>
          {options.map((row) => <option key={row.id} value={row.id}>{labelFor(row)}</option>)}
        </select>
      ) : (
        <input name={name} type={type === 'quantity' ? 'number' : type} defaultValue={value}
          maxLength={240} min={type === 'quantity' ? 0 : undefined} step={type === 'quantity' ? '0.001' : undefined}
          required={!optional} />
      )}
    </label>
  )
}

function RecordForm({ page, data, initial, onSave, cancel, busy }) {
  const spec = sections[page]
  const [lines, setLines] = useState([{ ...emptyLine }])
  const [source, setSource] = useState('')
  const [project, setProject] = useState('')
  const [openingProject, setOpeningProject] = useState('')
  const [workbook, setWorkbook] = useState(null)
  const [reading, setReading] = useState(false)
  const preview = workbook?.sheets?.length
    ? parseBomWorkbookSheet(workbook.sheets[workbook.selected].data)
    : null
  const bomOptions = data.records.boms.filter((bom) => !project || bom.project === project)
  const sourceKind = spec.fields.find(([name]) => name === 'source')?.[2]
  const sourceRow = data.records[sourceKind]?.find((record) => record.id === source)
  const items = sourceRow?.lines
    ? data.records.items.filter((item) => sourceRow.lines.some((line) => line.item === item.id))
    : projectCatalogItems(data.records.items, data.records.boms, openingProject)
  const openingItemIds = openingProject ? new Set(items.map((item) => item.id)) : null
  function updateLine(index, field, value) {
    setLines(lines.map((line, current) => current === index ? { ...line, [field]: value } : line))
  }

  async function loadWorkbook(event) {
    const input = event.currentTarget
    const file = input.files?.[0]
    input.value = ''
    if (!file) return
    setWorkbook({ name: file.name })
    if (!/\.xlsx$/i.test(file.name) || file.size > 5 * 1024 * 1024) {
      setWorkbook({ name: file.name, error: 'Choose an Excel .xlsx file up to 5 MB.' })
      return
    }
    setReading(true)
    try {
      const { default: readExcelFile } = await import('read-excel-file/browser')
      const sheets = await readExcelFile(file, { parseNumber: (value) => value })
      const firstBom = sheets.findIndex((sheet) => bomHeaderIndex(sheet.data) >= 0)
      setWorkbook(sheets.length
        ? { name: file.name, sheets, selected: Math.max(0, firstBom) }
        : { name: file.name, error: 'This workbook has no worksheets.' })
    } catch {
      setWorkbook({ name: file.name, error: 'This workbook could not be read. Open it in Excel and save a copy as .xlsx.' })
    } finally {
      setReading(false)
    }
  }

  return (
    <form className="ims-panel ims-form" onSubmit={(event) => {
      event.preventDefault()
      const fields = Object.fromEntries(new FormData(event.currentTarget))
      if (workbook) {
        if (!reading && preview && !preview.errors.length) onSave({ ...fields, rows: preview.rows })
        return
      }
      onSave({ ...fields, ...(spec.lines ? { lines } : {}), id: initial?.id })
    }}>
      <h2>{initial ? 'Edit ' : 'New '}{spec.single}</h2>
      <div className="ims-form-grid">
        {spec.fields.map((field) => {
          const [name] = field
          const handler = name === 'source' ? (event) => {
            setSource(event.target.value)
            setLines([{ ...emptyLine }])
          } : name === 'project' && page === 'quotations' ? (event) => setProject(event.target.value) : undefined
          return <Field key={name} field={field} data={data} value={name === 'source' ? source : page === 'quotations' && name === 'project' ? project : initial?.[name]} onChange={handler} />
        })}
      </div>
      {page === 'boms' && (
        <section className="ims-bom-upload" aria-label="Excel BOM import">
          <div className="ims-actions">
            <label className="ims-field"><span>Upload BOM Excel</span>
              <input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                onChange={loadWorkbook} disabled={reading || busy} />
            </label>
            {workbook && <button type="button" className="ims-button ims-secondary" onClick={() => setWorkbook(null)}
              disabled={reading || busy}>Use manual entry</button>}
          </div>
          {reading && <p role="status">Reading the workbook…</p>}
          {workbook?.error && <p className="ims-error" role="alert">{workbook.error}</p>}
          {preview && (
            <>
              <div className="ims-panel-title">
                <h3>Preview {workbook.name}</h3>
                {workbook.sheets.length > 1 && <label className="ims-field"><span>Worksheet</span>
                  <select value={workbook.selected} disabled={busy}
                    onChange={(event) => setWorkbook({ ...workbook, selected: Number(event.target.value) })}>
                    {workbook.sheets.map((sheet, index) => <option key={sheet.sheet} value={index}>{sheet.sheet}</option>)}
                  </select>
                </label>}
              </div>
              {preview.errors.length > 0 && <div className="ims-error" role="alert">
                <strong>Fix these Excel entries and upload again</strong>
                <ul>{preview.errors.slice(0, 12).map((error) => <li key={error}>{error}</li>)}</ul>
                {preview.errors.length > 12 && <p>{preview.errors.length - 12} more issues found.</p>}
              </div>}
              {preview.rows.length > 0 && <>
                <p>Posting reuses matching SKUs and creates missing items. Add an optional SKU column to match already cataloged parts. Zero-quantity rows are kept for reference.</p>
                <BomWorkbookTable rows={preview.rows.slice(0, 100)} showSku={preview.rows.some((row) => row.sku)} />
              </>}
            </>
          )}
        </section>
      )}
      {page === 'quotations' && bomOptions.length > 0 && (
        <label className="ims-field ims-form-import"><span>Copy items from a BOM <small>optional</small></span>
          <select value="" onChange={(event) => {
            const bom = bomOptions.find((entry) => entry.id === event.target.value)
            if (!bom) return
            setProject(bom.project)
            setLines(bom.lines.map((line) => ({ ...line, price: '' })))
          }}>
            <option value="">Select a BOM</option>
            {bomOptions.map((row) => <option key={row.id} value={row.id}>{row.number}</option>)}
          </select>
        </label>
      )}
      {spec.lines && !workbook && (
        <fieldset className="ims-lines">
          <legend>Items</legend>
          {page === 'openings' && <label className="ims-field ims-search">
            <span>Filter items by project</span>
            <select value={openingProject} onChange={(event) => setOpeningProject(event.target.value)}>
              <option value="">All projects</option>
              {data.records.projects.map((entry) => <option key={entry.id} value={entry.id}>{labelFor(entry)}</option>)}
            </select>
          </label>}
          {!items.length && <p className="ims-empty">{openingProject
            ? 'This project has no items in its BOMs.'
            : 'Add an item to the catalog before posting this record.'}</p>}
          {lines.map((line, index) => (
            <div className="ims-line" key={index}>
              <label className="ims-field"><span>Item</span>
                <select value={line.item} onChange={(event) => updateLine(index, 'item', event.target.value)} required>
                  <option value="">Select an item</option>
                  {line.item && openingItemIds && !openingItemIds.has(line.item) && (
                    <option value={line.item}>{labelFor(data.records.items.find((item) => item.id === line.item))} (outside project filter)</option>
                  )}
                  {items.map((item) => <option key={item.id} value={item.id}>{labelFor(item)}</option>)}
                </select>
              </label>
              <label className="ims-field"><span>Quantity</span><input type="number" min="0.001" step="0.001" value={line.quantity}
                onChange={(event) => updateLine(index, 'quantity', event.target.value)} required /></label>
              {spec.prices && <label className="ims-field"><span>Unit price (INR)</span><input type="number" min="0" step="0.01" value={line.price}
                onChange={(event) => updateLine(index, 'price', event.target.value)} required /></label>}
              {lines.length > 1 && <button className="ims-button ims-secondary" type="button" onClick={() => setLines(lines.filter((_, current) => current !== index))}>Remove</button>}
            </div>
          ))}
          <button type="button" className="ims-button ims-secondary" disabled={lines.length >= 100} onClick={() => setLines([...lines, { ...emptyLine }])}>Add line</button>
        </fieldset>
      )}
      {page === 'closings' && <p>Record the stock balance as of this date and prevent further stock movements in the closed period.</p>}
      <div className="ims-actions">
        <button className="ims-button" disabled={busy || (workbook && (reading || !preview || preview.errors.length > 0))}>
          {workbook ? 'Import and post BOM' : editable.includes(page) ? 'Save record' : 'Post document'}
        </button>
        <button type="button" className="ims-button ims-secondary" onClick={cancel}>Cancel</button>
      </div>
    </form>
  )
}

function PasswordForm({ forced, submit, busy }) {
  return (
    <form className="ims-panel ims-form" onSubmit={(event) => {
      event.preventDefault()
      submit(Object.fromEntries(new FormData(event.currentTarget)), event.currentTarget)
    }}>
      <h2>Change password</h2>
      {forced && <p>Replace your temporary password to open the workspace.</p>}
      <label className="ims-field"><span>Current password</span><input name="current" type="password" autoComplete="current-password" required maxLength={256} /></label>
      <label className="ims-field"><span>New password</span><input name="password" type="password" autoComplete="new-password" required minLength={12} maxLength={256} /></label>
      <label className="ims-field"><span>Confirm new password</span><input name="confirm" type="password" autoComplete="new-password" required minLength={12} maxLength={256} /></label>
      <button className="ims-button" disabled={busy}>Update password</button>
    </form>
  )
}

function UserForm({ reset, save, cancel, busy }) {
  return (
    <form className="ims-panel ims-form" onSubmit={(event) => {
      event.preventDefault()
      save(Object.fromEntries(new FormData(event.currentTarget)))
    }}>
      <h2>{reset ? 'Reset password for ' + reset : 'Create team account'}</h2>
      {reset ? <input type="hidden" name="userId" value={reset} /> : (
        <>
          <label className="ims-field"><span>User ID</span><input name="userId" pattern="[A-Za-z0-9_.\-]+" maxLength={64} autoComplete="off" required /></label>
          <label className="ims-field"><span>Role</span><select name="role" required>
            <option value="">Select a role</option><option value="manager">Manager</option><option value="store_person">Store Person</option>
          </select></label>
        </>
      )}
      <label className="ims-field"><span>Temporary password</span><input name="password" type="password" autoComplete="new-password" required minLength={12} maxLength={256} /></label>
      <p>The user must set a new password at their next sign-in.</p>
      <div className="ims-actions"><button className="ims-button" disabled={busy}>{reset ? 'Reset password' : 'Create account'}</button>
        <button type="button" className="ims-button ims-secondary" onClick={cancel}>Cancel</button></div>
    </form>
  )
}

function exportStock(data) {
  const cell = (value) => {
    let text = String(value ?? '')
    if (/^[=+\-@\t\r\n]/.test(text)) text = "'" + text
    return '"' + text.replaceAll('"', '""') + '"'
  }
  const csv = [stockColumns.map(([, title]) => cell(title)), ...data.map((row) => stockColumns.map(([key]) => cell(row[key])))].map((row) => row.join(',')).join('\r\n')
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = 'ims-stock.csv'
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function Workspace({ session, onSession, logout, logoutStatus, logoutPending }) {
  const [page, setPage] = useState(session.mustChangePassword ? 'password' : 'overview')
  const [collapsed, setCollapsed] = useState(() => window.matchMedia('(max-width: 720px)').matches)
  const [data, setData] = useState(null)
  const [extras, setExtras] = useState([])
  const [form, setForm] = useState(null)
  const [detail, setDetail] = useState(null)
  const [search, setSearch] = useState('')
  const [message, setMessage] = useState('')
  const [failure, setFailure] = useState('')
  const [busy, setBusy] = useState(false)
  const [revision, refresh] = useState(0)
  const spec = sections[page]
  const title = Object.values(groups).flat().find(([key]) => key === page)?.[1]

  useEffect(() => {
    if (session.mustChangePassword) return
    let active = true
    const endpoint = ['users', 'audit'].includes(page) ? page : 'inventory'
    api(endpoint).then((result) => {
      if (active) (endpoint === 'inventory' ? setData : setExtras)(result)
    }).catch((error) => {
      if (!active) return
      if (error.status === 401) onSession(null)
      else setFailure(error.message)
    })
    return () => { active = false }
  }, [page, revision, session.mustChangePassword, onSession])

  function navigate(key) {
    setForm(null)
    setDetail(null)
    setExtras([])
    setSearch('')
    setFailure('')
    setMessage('')
    setPage(key)
  }

  async function run(work, success) {
    if (busy) return
    setBusy(true)
    setMessage('')
    setFailure('')
    try {
      await work()
      setForm(null)
      refresh((count) => count + 1)
      setMessage(success)
    } catch (error) {
      if (error.status === 401) onSession(null)
      else setFailure(error.message)
    } finally {
      setBusy(false)
    }
  }

  function changePassword(body, element) {
    if (body.password !== body.confirm) {
      setFailure('The new passwords do not match.')
      return
    }
    void run(async () => {
      await api('change-password', { current: body.current, password: body.password })
      element.reset()
      if (session.mustChangePassword) {
        onSession({ ...session, mustChangePassword: false })
        navigate('overview')
      }
    }, 'Password updated.')
  }

  const searchRows = (rows) => rows.filter((row) => JSON.stringify(row).toLowerCase().includes(search.trim().toLowerCase()))
  const render = (key, row) => formatCell(key, row[key], row, data, page)
  const stockRows = data?.balances ?? []
  const lowStock = stockRows.filter((row) => Number(row.quantity) <= Number(row.minimum))
  const openOrders = data?.records.orders.filter((order) => order.status !== 'Received') ?? []
  const metrics = [
    ['items', 'Catalog items', stockRows.length], ['stock', 'At reorder level', lowStock.length],
    ['orders', 'Open purchase orders', openOrders.length], ['projects', 'Projects', data?.records.projects.length ?? 0],
  ]

  return (
    <div className={'ims-workspace' + (collapsed ? ' ims-collapsed' : '')}>
      <a className="skip-link" href="#workspace-main">Skip to content</a>
      <aside className="ims-sidebar">
        <div className="ims-brand"><i aria-hidden="true" /><span>Neurolinx IMS</span></div>
        <button type="button" className="ims-menu-toggle" aria-controls="ims-navigation" aria-expanded={!collapsed}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} onClick={() => setCollapsed(!collapsed)}><span aria-hidden="true">☰</span><span>Collapse</span></button>
        <nav id="ims-navigation" aria-label="Workspace navigation">
          {Object.entries(groups).map(([group, links]) => {
            const available = links.filter(([key]) => {
              if (session.mustChangePassword) return key === 'password'
              if (key === 'users') return session.role === 'admin'
              if (key === 'audit') return session.role !== 'store_person'
              return canRead(session.role, key)
            })
            return available.length > 0 && <div className="ims-nav-group" key={group}>
              <p>{group}</p>
              {available.map(([key, label]) => (
                <button key={key} title={label} type="button" aria-current={page === key ? 'page' : undefined} onClick={() => navigate(key)}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={navigationIcons[key]} /></svg>
                  <span>{label}</span>
                </button>
              ))}
            </div>
          })}
        </nav>
      </aside>
      <div className="ims-workspace-body">
        <header className="ims-topbar">
          <span>Inventory Management System</span>
          <div><span>{session.userId} · {roles[session.role]}</span><button type="button" className="ims-button ims-secondary" onClick={logout} disabled={logoutPending}>Log out</button></div>
        </header>
        <main id="workspace-main" tabIndex={-1} className={page === 'boms' && detail ? 'ims-main ims-main-bom' : 'ims-main'}>
          <div className="ims-page-title"><h1>{page === 'password' ? 'Account security' : title}</h1>
            {spec && !form && data && canWrite(session.role, page) && <button className="ims-button" onClick={() => { setDetail(null); setForm({}) }}>New {spec.single}</button>}
            {page === 'users' && !form && <button className="ims-button" onClick={() => setForm({})}>Create account</button>}
            {page === 'stock' && stockRows.length > 0 && <button className="ims-button ims-secondary" onClick={() => exportStock(searchRows(stockRows))}>Export CSV</button>}
          </div>
          {(failure || logoutStatus) && <p className="ims-error" role="alert">{failure || logoutStatus}</p>}
          {message && <p className="ims-success" role="status">{message}</p>}
          {page === 'overview' && data && (
            <>
              <div className="ims-metrics">{metrics.map(([key, label, value]) => <button key={key} className="ims-panel" type="button" onClick={() => navigate(key)}><span>{label}</span><strong>{value}</strong></button>)}</div>
              <div className="ims-overview">
                <section className="ims-panel"><h2>Items at reorder level</h2><Table rows={lowStock.slice(0, 8)} columns={stockColumns} empty="No items are at their reorder level." /></section>
                <section className="ims-panel"><h2>Open purchase orders</h2><Table rows={openOrders.slice(0, 8)} columns={sections.orders.columns.slice(0, -1)} renderCell={(key, row) => formatCell(key, row[key], row, data, 'orders')} empty="No open purchase orders." /></section>
              </div>
            </>
          )}
          {page === 'password' && <PasswordForm forced={session.mustChangePassword} submit={changePassword} busy={busy} />}
          {page === 'users' && (
            <>
              {form && <UserForm key={form.reset ?? 'new'} reset={form.reset} cancel={() => setForm(null)} busy={busy} save={(body) => run(() => api(form.reset ? 'users/reset' : 'users', body), form.reset ? 'Password reset.' : 'Account created.')} />}
              <section className="ims-panel"><Table rows={extras} columns={ [['userId', 'User ID'], ['role', 'Role'], ['mustChangePassword', 'Status']] } renderCell={render}
                action={(row) => row.role !== 'admin' && <button className="ims-text-button" onClick={() => setForm({ reset: row.userId })}>Reset password</button>} /></section>
            </>
          )}
          {page === 'audit' && <section className="ims-panel"><Table rows={extras} columns={auditColumns} renderCell={render} empty="No recorded activity." /></section>}
          {['overview', 'stock'].includes(page) || spec ? !data && !failure && <p className="ims-empty" role="status">Loading inventory…</p> : null}
          {data && (spec || page === 'stock') && (
            <>
              {form && <RecordForm key={form.id ?? 'new'} page={page} data={data} initial={form.id ? form : null}
                onSave={(body) => run(() => api(page === 'boms' && body.rows ? 'inventory/boms/import' : 'inventory/' + page, body),
                  body.rows ? 'BOM imported and posted.' : 'Record saved.')} cancel={() => setForm(null)} busy={busy} />}
              {detail && <section className="ims-panel ims-form">
                <div className="ims-panel-title"><h2>{labelFor(detail)}</h2><button className="ims-text-button" onClick={() => setDetail(null)}>Close details</button></div>
                <dl>{spec.fields.map(([key, label]) => <React.Fragment key={key}><dt>{label}</dt><dd>{render(key, detail)}</dd></React.Fragment>)}</dl>
                {detail.lines && (page === 'boms' ? (
                  <BomStockPlan key={detail.id} reference={detail.number} project={render('project', detail)}
                    lines={detail.lines} balances={stockRows}
                    sourceRows={detail.sourceRows} showPrice={session.role !== 'store_person'} />
                ) : (
                  <Table rows={detail.lines.map((line) => ({ ...line, id: line.item }))}
                    columns={ [['item', 'Item'], ['quantity', 'Quantity'], ...(detail.lines.some((line) => line.price !== undefined) ? [['price', 'Unit price (INR)']] : [])] }
                    renderCell={(key, row) => key === 'item' ? (row.code ? row.code + ' · ' + row.name : labelFor(data.records.items.find((item) => item.id === row.item))) : row[key]} />
                ))}
              </section>}
              <section className="ims-panel">
                <label className="ims-field ims-search"><span>Search {title.toLowerCase()}</span><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
                <Table rows={searchRows(spec ? data.records[page] : stockRows)} columns={spec?.columns.filter(([key]) => session.role !== 'store_person' || key !== 'total') ?? stockColumns}
                  renderCell={render} empty={search ? 'No matching records.' : 'No records yet.'}
                  action={spec ? (row) => <div className="ims-actions">
                    <button className="ims-text-button" onClick={() => {
                      setForm(null)
                      setDetail(row)
                      if (page === 'boms') refresh((count) => count + 1)
                    }}>View</button>
                    {editable.includes(page) && canWrite(session.role, page) && <button className="ims-text-button" onClick={() => { setDetail(null); setForm(row) }}>Edit</button>}
                  </div> : undefined} />
              </section>
            </>
          )}
        </main>
      </div>
    </div>
  )
}
