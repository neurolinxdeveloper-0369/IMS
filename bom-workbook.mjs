export const bomWorkbookColumns = [
  ['serial', 'S.No', ['sn', 'sno', 'serialno', 'serialnumber']],
  ['category', 'Category', ['category']],
  ['designators', 'Designators', ['designators', 'designator', 'refdes', 'references']],
  ['manufacturer', 'Manufacturer', ['manufacturer', 'mfr', 'make']],
  ['part', 'Part No. / Value', ['partnovalue', 'partnumbervalue', 'partno', 'partnumber', 'mpn']],
  ['technicalData', 'Technical Data', ['technicaldata', 'description', 'specifications']],
  ['quantity', 'Qty / Card', ['qtycard', 'quantitycard', 'qtypercard', 'quantitypercard', 'qtyperpcb', 'qty', 'quantity']],
  ['unitPrice', 'Unit Price (INR)', ['unitpriceinr', 'unitprice', 'priceinr']],
]
export const bomSkuColumn = ['sku', 'SKU', ['sku', 'itemcode']]
const importColumns = [...bomWorkbookColumns, bomSkuColumn]

function normalizeHeader(cell) {
  return String(cell ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')
}

function columnsAt(row) {
  const headers = row.map(normalizeHeader)
  return Object.fromEntries(importColumns.map(([key, , names]) => [
    key, headers.findIndex((name) => names.includes(name)),
  ]))
}

export function bomHeaderIndex(data) {
  return data.findIndex((row) => {
    const columns = columnsAt(row)
    return columns.quantity >= 0 && (columns.part >= 0 || columns.sku >= 0)
  })
}

function cellText(cell) {
  const value = String(cell ?? '').trim()
  return /^[-–—]$/.test(value) ? '' : value
}

function decimal(value, scale) {
  return new RegExp('^\\d{1,9}(?:\\.\\d{1,' + scale + '})?$').test(value)
}

function priceText(value) {
  // Some spreadsheet exports replace the rupee sign with ? or U+FFFD.
  const stripped = value.replace(/^(?:₹|INR|[?\uFFFD])\s*(?=\d)/i, '')
  if (!stripped.includes(',')) return stripped
  if (!/^(?:\d{1,3}(?:,\d{3})+|\d{1,2}(?:,\d{2})*,\d{3})(?:\.\d{1,2})?$/.test(stripped)) return stripped
  return stripped.replaceAll(',', '')
}

export function parseBomWorkbookSheet(data) {
  const header = bomHeaderIndex(data)
  if (header === -1) {
    return { rows: [], errors: ['No BOM header found. Include Qty / Card and either Part No. / Value or SKU.'] }
  }
  const indexes = columnsAt(data[header])
  const errors = []
  const rows = []
  for (const [offset, input] of data.slice(header + 1).entries()) {
    const rowNumber = header + offset + 2
    const values = Object.fromEntries(importColumns.map(([key]) => [key, cellText(input[indexes[key]])]))
    if (!Object.values(values).some(Boolean)) continue
    if (Number(values.quantity) > 0 && !values.part && !values.sku) {
      errors.push(`Row ${rowNumber} needs a part number, value, or SKU.`)
    }
    if (!decimal(values.quantity, 3)) errors.push(`Row ${rowNumber} needs a non-negative Qty / Card with up to three decimals.`)
    values.unitPrice = priceText(values.unitPrice)
    if (values.unitPrice && !decimal(values.unitPrice, 2)) errors.push(`Row ${rowNumber} has an invalid unit price.`)
    for (const [key, label] of importColumns) {
      if (values[key].length > 240) errors.push(`Row ${rowNumber} has more than 240 characters in ${label}.`)
      if (input[indexes[key]] instanceof Date) errors.push(`Row ${rowNumber} looks like an Excel date in ${label}. Format that cell as text and re-enter the original value.`)
    }
    rows.push({ id: rowNumber, ...values, name: values.part || values.sku })
  }
  if (!rows.length) errors.push('This worksheet has no BOM rows.')
  if (rows.length > 100) errors.push('Upload at most 100 BOM rows at a time.')
  if (rows.length && !rows.some((row) => Number(row.quantity) > 0)) errors.push('At least one row needs a Qty / Card greater than zero.')
  return { rows, errors }
}

export function joinBomPlanningRows(lines, sourceRows = []) {
  const byItem = new Map(lines.map((line) => [String(line.item), {
    id: 'item-' + line.item, line, sourceRows: [],
  }]))
  const rows = []
  for (const [index, source] of sourceRows.entries()) {
    const row = byItem.get(String(source.item))
    if (!row) {
      rows.push({ id: 'source-' + index, sourceRows: [source] })
      continue
    }
    if (!row.sourceRows.length) rows.push(row)
    row.sourceRows.push(source)
  }
  for (const row of byItem.values()) {
    if (!row.sourceRows.length) rows.push(row)
  }
  return rows
}
