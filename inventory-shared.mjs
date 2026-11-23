export const roles = {
  admin: 'Admin',
  manager: 'Manager',
  store_person: 'Store Person',
}

export const sections = {
  items: { label: 'Items', single: 'item', columns: [['code', 'SKU'], ['name', 'Item'], ['unit', 'Unit'], ['minimum', 'Reorder level']], fields: [
    ['code', 'SKU'], ['name', 'Item name'], ['unit', 'Unit of measure'], ['minimum', 'Reorder level', 'quantity'],
  ] },
  vendors: { label: 'Vendors', single: 'vendor', columns: [['code', 'Code'], ['name', 'Vendor'], ['email', 'Email'], ['phone', 'Phone']], fields: [
    ['code', 'Vendor code'], ['name', 'Vendor name'], ['email', 'Email', 'email', true], ['phone', 'Phone', 'text', true], ['address', 'Address', 'text', true],
  ] },
  projects: { label: 'Projects', single: 'project', columns: [['code', 'Code'], ['name', 'Project'], ['description', 'Description']], fields: [
    ['code', 'Project code'], ['name', 'Project name'], ['description', 'Description', 'text', true],
  ] },
  boms: { label: 'Bills of materials', single: 'BOM', columns: [['number', 'BOM'], ['project', 'Project'], ['lineCount', 'Items']], fields: [
    ['number', 'BOM reference'], ['project', 'Project', 'projects'],
  ], lines: true },
  quotations: { label: 'Quotations', single: 'quotation', columns: [['number', 'Quotation'], ['vendor', 'Vendor'], ['date', 'Date'], ['status', 'Status'], ['total', 'Total (INR)']], fields: [
    ['number', 'Vendor quotation reference'], ['vendor', 'Vendor', 'vendors'], ['date', 'Date', 'date'], ['project', 'Project', 'projects', true],
  ], lines: true, prices: true },
  orders: { label: 'Purchase orders', single: 'purchase order', columns: [['number', 'PO'], ['vendor', 'Vendor'], ['source', 'Quotation'], ['date', 'Date'], ['status', 'Status'], ['total', 'Total (INR)']], fields: [
    ['number', 'Purchase order reference'], ['source', 'Quotation', 'quotations'], ['date', 'Date', 'date'],
  ] },
  receipts: { label: 'Goods receipts (GRN)', single: 'GRN', columns: [['number', 'GRN'], ['source', 'Purchase order'], ['date', 'Date'], ['lineCount', 'Items']], fields: [
    ['number', 'GRN reference'], ['source', 'Purchase order', 'orders'], ['date', 'Date', 'date'],
  ], lines: true },
  invoices: { label: 'Purchase invoices', single: 'invoice', columns: [['number', 'Invoice'], ['vendor', 'Vendor'], ['source', 'GRN'], ['date', 'Date'], ['total', 'Total (INR)']], fields: [
    ['number', 'Vendor invoice reference'], ['source', 'Goods receipt', 'receipts'], ['date', 'Date', 'date'],
  ] },
  openings: { label: 'Opening stock', single: 'opening entry', columns: [['number', 'Reference'], ['date', 'Date'], ['lineCount', 'Items']], fields: [
    ['number', 'Opening reference'], ['date', 'Date', 'date'],
  ], lines: true },
  issues: { label: 'Stock issues', single: 'stock issue', columns: [['number', 'Reference'], ['project', 'Project'], ['source', 'BOM'], ['date', 'Date'], ['lineCount', 'Items']], fields: [
    ['number', 'Stock issue reference'], ['source', 'BOM', 'boms'], ['date', 'Date', 'date'],
  ], lines: true },
  closings: { label: 'Closing stock', single: 'closing snapshot', columns: [['number', 'Reference'], ['date', 'Date'], ['lineCount', 'Items']], fields: [
    ['number', 'Closing reference'], ['date', 'Date', 'date'],
  ] },
}

export function canWrite(role, section) {
  return role === 'admin' || role === 'manager' || ['receipts', 'issues'].includes(section)
}

export function canRead(role, section) {
  return role !== 'store_person' || !['quotations', 'invoices'].includes(section)
}
