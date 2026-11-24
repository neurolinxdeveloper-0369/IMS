import { createHash } from 'node:crypto'
import { sections, canRead, canWrite } from './inventory-shared.mjs'
import { migrateBomComponentNames, migrateBomSourceRows, migrateInventory, migrateInventoryReads } from './inventory-migration.mjs'

export async function initInventory(pool) {
  await transaction(pool, async (db) => {
    await db.query(`
    CREATE TABLE IF NOT EXISTS ims_records (
      id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      kind text NOT NULL,
      reference text NOT NULL,
      body jsonb NOT NULL,
      created_by text NOT NULL REFERENCES ims_users(user_id),
      created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE(kind, reference)
    );
    CREATE TABLE IF NOT EXISTS ims_stock_ledger (
      record_id bigint NOT NULL REFERENCES ims_records(id),
      item_id bigint NOT NULL REFERENCES ims_records(id),
      quantity numeric(18,3) NOT NULL CHECK (quantity <> 0),
      PRIMARY KEY(record_id, item_id)
    );
    CREATE INDEX IF NOT EXISTS ims_stock_item_idx ON ims_stock_ledger (item_id);
    CREATE TABLE IF NOT EXISTS ims_audit (
      id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      actor text NOT NULL REFERENCES ims_users(user_id),
      action text NOT NULL,
      reference text NOT NULL,
      happened_at timestamptz NOT NULL DEFAULT now()
    );
    `)
    await migrateInventory(db)
    await migrateInventoryReads(db)
    await migrateBomSourceRows(db)
    await migrateBomComponentNames(db)
  })
}

export class RequestError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

function check(condition, message, status = 400) {
  if (!condition) throw new RequestError(status, message)
}

export async function transaction(pool, work) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const result = await work(client)
    await client.query('COMMIT')
    return result
  } catch (error) {
    await client.query('ROLLBACK')
    if (error.code === '23505') throw new RequestError(409, 'That reference already exists.')
    throw error
  } finally {
    client.release()
  }
}

export function audit(db, actor, action, reference) {
  return db.query('INSERT INTO ims_audit (actor, action, reference) VALUES ($1, $2, $3)', [actor, action, reference])
}

function numeric(value, label, decimals, allowZero = false) {
  const pattern = new RegExp('^\\d{1,9}(?:\\.\\d{1,' + decimals + '})?$')
  const amount = Number(value)
  check(pattern.test(String(value)) && (allowZero ? amount >= 0 : amount > 0), label + ' is invalid.')
  return amount
}

function fixed(value, scale = 1000) {
  return Math.round(Number(value) * scale)
}

async function findRecord(db, kind, id) {
  check(/^\d{1,18}$/.test(String(id)), 'Choose an existing ' + sections[kind].single + '.')
  const { rows: [row] } = await db.query('SELECT id::text, body FROM ims_inventory_read WHERE kind = $1 AND id = $2', [kind, id])
  check(row, 'The selected ' + sections[kind].single + ' no longer exists.', 409)
  return { id: row.id, ...row.body }
}

function date(value, label) {
  const parsed = new Date(value + 'T00:00:00Z')
  check(/^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(+parsed)
    && parsed.toISOString().slice(0, 10) === value, label + ' is invalid.')
  return value
}

async function readFields(db, kind, input) {
  const result = {}
  for (const [key, label, type, optional] of sections[kind].fields) {
    const value = typeof input[key] === 'string' ? input[key].trim() : ''
    if (!value && optional) continue
    check(value && value.length <= 240, label + ' is required and must be 240 characters or fewer.')
    if (sections[type]) result[key] = (await findRecord(db, type, value)).id
    else if (type === 'quantity') result[key] = numeric(value, label, 3, true)
    else if (type === 'date') result[key] = date(value, label)
    else {
      if (type === 'email') check(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value), 'Enter a valid email address.')
      result[key] = value
    }
  }
  return result
}

async function readLines(db, input, prices) {
  check(Array.isArray(input) && input.length > 0 && input.length <= 100, 'Add between 1 and 100 items.')
  const seen = new Set()
  const lines = []
  for (const row of input) {
    check(row && typeof row === 'object', 'An item line is invalid.')
    const item = await findRecord(db, 'items', row.item)
    check(!seen.has(item.id), 'Each item can appear only once per document.')
    seen.add(item.id)
    const line = { item: item.id, quantity: numeric(row.quantity, 'Quantity', 3) }
    if (prices) line.price = numeric(row.price, 'Unit price', 2, true)
    lines.push(line)
  }
  return lines
}

const bomImportFields = ['sku', 'name', 'category', 'designators', 'manufacturer', 'part', 'technicalData', 'serial']

function parseBomSourceRow(input, label) {
  check(input && typeof input === 'object' && !Array.isArray(input), label + ' is invalid.')
  const fields = {}
  for (const key of bomImportFields) {
    const raw = input[key]
    if (raw === undefined || raw === null || raw === '') continue
    check(typeof raw === 'string' || (typeof raw === 'number' && Number.isFinite(raw)), label + ' has an invalid ' + key + '.')
    const value = String(raw).trim()
    check(value.length <= 240 && !value.includes('\0'), label + ' has an invalid ' + key + '.')
    if (value) fields[key] = value
  }
  const quantity = numeric(input.quantity, label + ' quantity', 3, true)
  const unitPrice = input.unitPrice === undefined || input.unitPrice === null || input.unitPrice === ''
    ? null : numeric(input.unitPrice, label + ' unit price', 2, true)
  if (quantity > 0) {
    check(fields.sku || fields.part, label + ' needs a SKU or a Part No. / Value.')
    if (!fields.sku) {
      const identity = ['manufacturer', 'part', 'technicalData'].map((key) =>
        (fields[key] ?? '').normalize('NFKC').toUpperCase().replace(/\s+/g, ' '),
      )
      fields.sku = 'PCB-' + createHash('sha256').update(JSON.stringify(identity)).digest('hex').slice(0, 16).toUpperCase()
    }
  }
  return { fields, quantity, unitPrice }
}

async function insertInventoryRecord(db, actor, kind, body) {
  const { rows: [record] } = await db.query(`
    INSERT INTO ims_records (kind, reference, body, created_by) VALUES ($1, $2, $3, $4) RETURNING id
  `, [kind, body.code ?? body.number, body, actor.userId])
  return record
}

function insertBomSourceRow(db, bomId, rowNumber, row) {
  return db.query(`
    INSERT INTO ims_bom_source_rows (bom_id, row_number, item_id, quantity, unit_price, fields)
    VALUES ($1, $2, $3, $4, $5, $6)
  `, [bomId, rowNumber, row.item ?? null, row.quantity, row.unitPrice, row.fields])
}

export async function importBom(pool, actor, input) {
  check(canWrite(actor.role, 'boms'), 'You do not have permission for this action.', 403)
  check(Array.isArray(input?.rows) && input.rows.length > 0 && input.rows.length <= 100, 'Import between 1 and 100 BOM rows.')
  const rows = input.rows.map((row, index) => parseBomSourceRow(row, 'BOM row ' + (index + 1)))
  check(rows.some((row) => row.quantity > 0), 'Add at least one BOM row with a positive quantity.')

  return transaction(pool, async (db) => {
    await db.query('SELECT pg_advisory_xact_lock(3140322)')
    const body = await readFields(db, 'boms', input)
    const totals = new Map()
    const items = new Map()
    let itemsCreated = 0
    for (const row of rows) {
      if (row.quantity === 0) continue
      const { fields } = row
      if (!items.has(fields.sku)) {
        const { rows: [existing] } = await db.query('SELECT id::text FROM ims_items WHERE reference = $1', [fields.sku])
        if (existing) items.set(fields.sku, existing.id)
        else {
          const item = await insertInventoryRecord(db, actor, 'items', {
            code: fields.sku, name: fields.name ?? fields.technicalData ?? fields.part ?? fields.sku, unit: 'ea', minimum: 0,
          })
          items.set(fields.sku, String(item.id))
          await audit(db, actor.userId, 'Created item', fields.sku)
          itemsCreated += 1
        }
      }
      row.item = items.get(fields.sku)
      const total = (totals.get(row.item) ?? 0) + fixed(row.quantity)
      check(total <= 999999999999, 'The combined quantity for ' + fields.sku + ' is too large.')
      totals.set(row.item, total)
    }
    body.lines = Array.from(totals, ([item, quantity]) => ({ item, quantity: quantity / 1000 }))
    const { id } = await insertInventoryRecord(db, actor, 'boms', body)
    for (const [index, row] of rows.entries()) {
      await insertBomSourceRow(db, id, index + 1, row)
    }
    await audit(db, actor.userId, 'Imported BOM', body.number)
    return { id, lineCount: body.lines.length, itemsCreated }
  })
}

export async function addBomComponent(pool, actor, input) {
  check(canWrite(actor.role, 'boms'), 'You do not have permission for this action.', 403)
  check(input && typeof input === 'object' && !Array.isArray(input), 'Enter a valid BOM component.')
  const creatingItem = Object.hasOwn(input, 'newItem')
  check(creatingItem !== Object.hasOwn(input, 'item'), 'Choose an existing item or enter one new catalog item.')
  if (creatingItem) {
    check(canWrite(actor.role, 'items'), 'You do not have permission to create catalog items.', 403)
    check(input.newItem && typeof input.newItem === 'object' && !Array.isArray(input.newItem), 'Enter a valid catalog item.')
  }

  return transaction(pool, async (db) => {
    await db.query('SELECT pg_advisory_xact_lock(3140322)')
    const bom = await findRecord(db, 'boms', input.bomId)
    const item = creatingItem
      ? await readFields(db, 'items', {
        ...input.newItem,
        minimum: typeof input.newItem.minimum === 'number' ? String(input.newItem.minimum) : input.newItem.minimum,
      })
      : await findRecord(db, 'items', input.item)
    if (!creatingItem) {
      check(!bom.lines.some((line) => line.item === item.id), 'This item is already on the BOM.', 409)
    }
    check(bom.lines.length < 100, 'A BOM can contain up to 100 items.', 409)
    const row = parseBomSourceRow({ ...input, sku: item.code, name: item.name }, 'BOM component')
    check(row.quantity > 0, 'BOM component quantity must be greater than zero.')
    if (creatingItem) {
      check(!item.unit.includes('\0'), 'Enter a valid unit of measure.')
      const { rows: [existing] } = await db.query(`
        SELECT EXISTS (SELECT 1 FROM ims_items WHERE reference = $1) AS in_catalog,
          EXISTS (SELECT 1 FROM ims_records WHERE kind = 'items' AND reference = $1) AS in_legacy
      `, [item.code])
      check(!existing.in_catalog, 'That SKU already exists. Select Use existing item to choose it.', 409)
      check(!existing.in_legacy, 'That SKU exists in older IMS records but is missing from the item catalog. Ask an administrator to reconcile the item before reusing its SKU.', 409)
      const created = await insertInventoryRecord(db, actor, 'items', item)
      item.id = String(created.id)
      await audit(db, actor.userId, 'Created item', item.code)
    }

    const { rows: [source] } = await db.query(`
      SELECT max(row_number) AS last_row FROM ims_bom_source_rows WHERE bom_id = $1
    `, [bom.id])
    let lastRow = source.last_row
    if (lastRow === null) {
      // Manual BOMs lack source rows. Preserve their line order in the planner and Excel export.
      const seeded = await db.query(`
        INSERT INTO ims_bom_source_rows (bom_id, row_number, item_id, quantity, fields)
        SELECT l.document_id, l.line_number, l.item_id, l.quantity,
          jsonb_build_object('sku', i.reference, 'name', i.name)
        FROM ims_boms_lines l
        JOIN ims_items i ON i.id = l.item_id
        WHERE l.document_id = $1
      `, [bom.id])
      lastRow = seeded.rowCount
    }

    const line = { item: item.id, quantity: row.quantity }
    // Use the current mirrored BOM lines so an older compatibility record cannot restore a removed component.
    await db.query(`
      UPDATE ims_records SET body = jsonb_set(body, '{lines}', $2::jsonb)
      WHERE id = $1 AND kind = 'boms'
    `, [bom.id, JSON.stringify([...bom.lines, line])])
    await insertBomSourceRow(db, bom.id, lastRow + 1, { ...row, item: item.id })
    await audit(db, actor.userId, 'Added BOM component', bom.number + ' · ' + item.code)
    return { id: bom.id, bomId: bom.id, ...line }
  })
}

export async function renameBomComponent(pool, actor, input) {
  check(canWrite(actor.role, 'boms'), 'You do not have permission for this action.', 403)
  const name = typeof input?.name === 'string' ? input.name.trim() : ''
  check(name.length > 0 && name.length <= 240 && !name.includes('\0'),
    'Enter a component display name between 1 and 240 characters.')
  return transaction(pool, async (db) => {
    await db.query('SELECT pg_advisory_xact_lock(3140322)')
    const bom = await findRecord(db, 'boms', input.bomId)
    const item = await findRecord(db, 'items', input.item)
    check(bom.lines.some((line) => line.item === item.id), 'This item is not on the BOM.', 409)

    const result = await db.query(`
      INSERT INTO ims_bom_component_names (bom_id, item_id, name) VALUES ($1, $2, $3)
      ON CONFLICT (bom_id, item_id) DO UPDATE SET name = EXCLUDED.name
      WHERE ims_bom_component_names.name IS DISTINCT FROM EXCLUDED.name
    `, [bom.id, item.id, name])
    if (result.rowCount) await audit(db, actor.userId, 'Renamed BOM component', bom.number + ' · ' + item.code)
    return { bomId: bom.id, item: item.id, displayName: name }
  })
}

async function linked(db, kind, source) {
  const { rows } = await db.query('SELECT body FROM ims_inventory_read WHERE kind = $1 AND source_id = $2', [kind, source])
  return rows.map((row) => row.body)
}

function remaining(original, posted) {
  const quantities = new Map(original.map((line) => [line.item, fixed(line.quantity)]))
  for (const record of posted) {
    for (const line of record.lines) {
      quantities.set(line.item, (quantities.get(line.item) ?? 0) - fixed(line.quantity))
    }
  }
  return quantities
}

async function stock(db, through) {
  if (!through) {
    const { rows } = await db.query(`
      SELECT item_id AS id, sku AS code, name, unit, reorder_level AS minimum, quantity
      FROM ims_stock_on_hand ORDER BY sku
    `)
    return rows
  }
  const { rows } = await db.query(`
    SELECT i.id, i.reference AS code, i.name, i.unit, i.reorder_level AS minimum,
      coalesce(sum(l.quantity) FILTER (WHERE movement.document_date <= $1::date), 0) AS quantity
    FROM ims_items i
    LEFT JOIN ims_stock_ledger l ON l.item_id = i.id
    LEFT JOIN ims_stock_documents movement ON movement.id = l.record_id
    GROUP BY i.id ORDER BY i.reference
  `, [through])
  return rows
}

async function prepareDocument(db, kind, body) {
  switch (kind) {
    case 'orders': {
      const quote = await findRecord(db, 'quotations', body.source)
      check((await linked(db, kind, body.source)).length === 0, 'A purchase order already exists for this quotation.', 409)
      check(body.date >= quote.date, 'The order date cannot be before the quotation date.')
      return { ...body, vendor: quote.vendor, project: quote.project, lines: quote.lines }
    }
    case 'receipts': {
      const order = await findRecord(db, 'orders', body.source)
      check(body.date >= order.date, 'The receipt date cannot be before the order date.')
      const available = remaining(order.lines, await linked(db, kind, body.source))
      const orderLines = new Map(order.lines.map((line) => [line.item, line]))
      for (const line of body.lines) {
        check(fixed(line.quantity) <= (available.get(line.item) ?? 0), 'Receipt quantity exceeds the remaining purchase order quantity.', 409)
        line.price = orderLines.get(line.item).price
      }
      return { ...body, vendor: order.vendor }
    }
    case 'invoices': {
      const receipt = await findRecord(db, 'receipts', body.source)
      check((await linked(db, kind, body.source)).length === 0, 'An invoice already exists for this receipt.', 409)
      check(body.date >= receipt.date, 'The invoice date cannot be before the receipt date.')
      return { ...body, vendor: receipt.vendor, lines: receipt.lines }
    }
    case 'issues': {
      const bom = await findRecord(db, 'boms', body.source)
      const available = remaining(bom.lines, await linked(db, kind, body.source))
      const balances = new Map((await stock(db)).map((item) => [item.id, fixed(item.quantity)]))
      for (const line of body.lines) {
        const quantity = fixed(line.quantity)
        check(quantity <= (available.get(line.item) ?? 0), 'Issue quantity exceeds the remaining BOM requirement.', 409)
        check(quantity <= (balances.get(line.item) ?? 0), 'There is insufficient stock for this issue.', 409)
      }
      return { ...body, project: bom.project }
    }
    case 'openings': {
      const { rows } = await db.query('SELECT DISTINCT item_id FROM ims_stock_ledger WHERE item_id = ANY($1::bigint[])', [body.lines.map((line) => line.item)])
      check(!rows.length, 'Opening stock must be the first movement for each item.', 409)
      return body
    }
    case 'closings': {
      const lines = (await stock(db, body.date)).map((item) => ({
        item: item.id, code: item.code, name: item.name, unit: item.unit, quantity: item.quantity,
      }))
      return { ...body, lines }
    }
    default: return body
  }
}

export async function saveInventory(pool, actor, kind, input) {
  check(Object.hasOwn(sections, kind) && canWrite(actor.role, kind), 'You do not have permission for this action.', 403)
  check(input && typeof input === 'object', 'Enter valid record data.')
  const spec = sections[kind]
  return transaction(pool, async (db) => {
    await db.query('SELECT pg_advisory_xact_lock(3140322)')
    const body = await readFields(db, kind, input)
    const reference = body.code ?? body.number
    if (input.id) {
      check(['items', 'vendors', 'projects'].includes(kind), 'Posted documents cannot be edited.', 409)
      const current = await findRecord(db, kind, input.id)
      await db.query('UPDATE ims_records SET reference = $1, body = $2 WHERE id = $3', [reference, body, current.id])
      await audit(db, actor.userId, 'Updated ' + spec.single, reference)
      return { id: current.id }
    }

    if (spec.lines) body.lines = await readLines(db, input.lines, spec.prices)
    if (['openings', 'issues', 'receipts', 'closings'].includes(kind)) {
      const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Kolkata' }).format()
      check(body.date <= today, 'Stock dates cannot be in the future.')
      const dates = await db.query('SELECT max(document_date)::text AS date FROM ims_closing_stock')
      const lastClose = dates.rows[0].date
      check(!lastClose || body.date > lastClose, 'The date must be after the last stock close.', 409)
      if (kind !== 'closings') {
        if (kind === 'issues') {
          const { rows } = await db.query(`
            SELECT max(r.document_date)::text AS date FROM ims_stock_ledger l
            JOIN ims_stock_documents r ON r.id = l.record_id WHERE l.item_id = ANY($1::bigint[])
          `, [body.lines.map((line) => line.item)])
          check(!rows[0].date || body.date >= rows[0].date, 'Stock issues cannot be backdated before an existing item movement.', 409)
        }
      }
    }
    const document = await prepareDocument(db, kind, body)
    const record = await insertInventoryRecord(db, actor, kind, document)

    if (['openings', 'receipts', 'issues'].includes(kind)) {
      const direction = kind === 'issues' ? -1 : 1
      for (const line of document.lines) {
        await db.query('INSERT INTO ims_stock_ledger VALUES ($1, $2, $3)', [
          record.id, line.item, (direction * line.quantity).toFixed(3),
        ])
      }
    }
    await audit(db, actor.userId, 'Created ' + spec.single, reference)
    return record
  })
}

export async function readInventory(pool, actor) {
  const { rows, balances, imported, componentNames } = await transaction(pool, async (db) => {
    await db.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY')
    const { rows } = await db.query('SELECT id::text, kind, body, created_at AS "createdAt" FROM ims_inventory_read ORDER BY ims_inventory_read.id DESC')
    const imported = await db.query(`
      SELECT bom_id::text AS bom, item_id::text AS item, quantity::float8 AS quantity, unit_price::float8 AS "unitPrice", fields
      FROM ims_bom_source_rows ORDER BY bom_id, row_number
    `)
    const componentNames = await db.query('SELECT bom_id::text AS bom, item_id::text AS item, name FROM ims_bom_component_names')
    return {
      rows,
      balances: await stock(db),
      imported: Map.groupBy(imported.rows, (row) => row.bom),
      componentNames: Map.groupBy(componentNames.rows, (row) => row.bom),
    }
  })
  const records = Object.fromEntries(Object.keys(sections).map((kind) => [kind, []]))
  for (const { id, kind, body, createdAt } of rows) {
    if (!canRead(actor.role, kind)) continue
    const record = { ...body, id, createdAt, lineCount: body.lines?.length }
    if (kind === 'boms' && imported.has(id)) {
      record.sourceRows = imported.get(id).map(({ item, quantity, unitPrice, fields }) => ({
        ...fields, quantity,
        ...(item === null ? {} : { item }),
        ...(unitPrice === null || actor.role === 'store_person' ? {} : { unitPrice }),
      }))
    }
    if (actor.role === 'store_person') {
      record.lines = record.lines?.map(({ item, quantity }) => ({ item, quantity }))
    } else if (body.lines?.some((line) => line.price !== undefined)) {
      const cents = body.lines.reduce((sum, line) => (
        sum + (BigInt(fixed(line.quantity)) * BigInt(fixed(line.price, 100)) + 500n) / 1000n
      ), 0n)
      record.total = (cents / 100n).toString() + '.' + (cents % 100n).toString().padStart(2, '0')
    }
    if (kind === 'boms' && componentNames.has(id)) {
      const names = new Map(componentNames.get(id).map(({ item, name }) => [item, name]))
      record.lines = record.lines.map((line) =>
        names.has(line.item) ? { ...line, displayName: names.get(line.item) } : line,
      )
    }
    records[kind].push(record)
  }
  const orderReceipts = Map.groupBy(records.receipts, (receipt) => receipt.source)
  const invoiced = new Set(records.invoices.map((invoice) => invoice.source))
  for (const order of records.orders) {
    const receipts = orderReceipts.get(order.id) ?? []
    const complete = [...remaining(order.lines, receipts).values()].every((quantity) => quantity === 0)
    order.status = complete ? 'Received' : receipts.length ? 'Part received' : 'Open'
  }
  for (const receipt of records.receipts) receipt.invoiced = invoiced.has(receipt.id)
  const ordered = new Set(records.orders.map((order) => order.source))
  for (const quote of records.quotations) quote.status = ordered.has(quote.id) ? 'Ordered' : 'Recorded'
  return { records, balances }
}

export async function readAudit(pool) {
  const { rows } = await pool.query(`
    SELECT id, actor, action, reference, happened_at AS "date" FROM ims_audit ORDER BY id DESC LIMIT 200
  `)
  return rows
}
