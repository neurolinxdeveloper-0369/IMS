const columnWidths = {
  'source-serial': 9,
  'source-category': 24,
  'source-designators': 22,
  'source-manufacturer': 22,
  'source-part': 24,
  'source-technicalData': 36,
  'source-unitPrice': 16,
  'source-quantity': 16,
  sku: 24,
  name: 26,
  quantity: 14,
  stock: 16,
  total: 16,
  shortage: 18,
  balance: 16,
}

function textCell(value, style = {}) {
  return { value: String(value ?? ''), type: String, format: '@', ...style }
}

function dataCell(value, key, style) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const format = key === 'source-unitPrice' ? '#,##0.00' : Number.isInteger(value) ? '#,##0' : '#,##0.###'
    return { value, type: Number, format, ...style }
  }
  return textCell(value, style)
}

function mergedCell(cell, span) {
  return [{ ...cell, columnSpan: span }, ...Array(span - 1).fill(null)]
}

export function createBomExcel({ reference, project, production, bomBasis, columns, rows }) {
  const widths = columns.map(([key]) => columnWidths[key] ?? 18)
  const meta = (label, value) => [
    ...mergedCell(textCell(label, { fontWeight: 'bold', textColor: '#365246', wrap: true, height: 21 }), 2),
    ...mergedCell(dataCell(value, '', { wrap: true }), columns.length - 2),
  ]
  const headers = columns.map(([, label]) => textCell(label, {
    backgroundColor: '#234A3C',
    textColor: '#FFFFFF',
    fontWeight: 'bold',
    height: 30,
    wrap: true,
    alignVertical: 'center',
  }))
  const data = [
    meta('BOM reference', reference),
    meta('Project', project),
    meta('Production quantity', production),
    meta('Units covered by BOM', bomBasis),
    headers,
    ...rows.map((row) => {
      if (row.heading) {
        return mergedCell(textCell(row.heading, {
          backgroundColor: '#E6EBE3',
          textColor: '#29372D',
          fontWeight: 'bold',
          height: 23,
          alignVertical: 'center',
        }), columns.length)
      }
      const lineCount = Math.max(...widths.map((width, index) =>
        String(row.cells[index] ?? '').split('\n').reduce((size, line) => size + Math.max(1, Math.ceil(line.length / width)), 0),
      ))
      return columns.map(([key], index) => dataCell(row.cells[index], key, {
        height: Math.min(400, 6 + 15 * lineCount),
        wrap: true,
        alignVertical: 'top',
        bottomBorderColor: '#E1E6DF',
        bottomBorderStyle: 'thin',
        ...(row.shortage ? { backgroundColor: '#FFF0DB' } : {}),
        ...(row.shortage && (key === 'shortage' || key === 'balance') ? { fontWeight: 'bold', textColor: '#804213' } : {}),
      }))
    }),
  ]
  const safeReference = String(reference ?? '').replace(/[<>:"/\\|?*\u0000-\u001F]/g, '-')
    .trim().slice(0, 120).replace(/[. ]+$/, '')
  const quantitySuffix = /^\d{1,9}$/.test(String(production)) ? `-qty-${production}` : ''

  return {
    data,
    fileName: `${safeReference || 'BOM'}${quantitySuffix}.xlsx`,
    options: {
      sheet: 'BOM',
      columns: widths.map((width) => ({ width })),
      stickyRowsCount: 5,
      stickyColumnsCount: 2,
      showGridLines: false,
    },
  }
}

export async function downloadBomExcel(input) {
  const { default: writeExcelFile } = await import('write-excel-file/browser')
  const { data, options, fileName } = createBomExcel(input)
  await writeExcelFile(data, options).toFile(fileName)
}
