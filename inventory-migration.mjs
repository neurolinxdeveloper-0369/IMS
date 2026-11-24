const date = ['document_date', 'date', "date"]
const vendor = ['vendor_id', 'vendor', 'bigint REFERENCES ims_vendors(id)']
const project = ['project_id', 'project', 'bigint REFERENCES ims_projects(id)', true]

const records = [
  ['items', 'ims_items', [
    ['name', 'name', 'text'], ['unit', 'unit', 'text'], ['reorder_level', 'minimum', 'numeric(18,3) CHECK (reorder_level >= 0)'],
  ]],
  ['vendors', 'ims_vendors', [
    ['name', 'name', 'text'], ['email', 'email', 'text', true], ['phone', 'phone', 'text', true], ['address', 'address', 'text', true],
  ]],
  ['projects', 'ims_projects', [['name', 'name', 'text'], ['description', 'description', 'text', true]]],
  ['boms', 'ims_boms', [['project_id', 'project', 'bigint REFERENCES ims_projects(id)']], true],
  ['quotations', 'ims_quotations', [vendor, project, date], true, true],
  ['orders', 'ims_purchase_orders', [
    ['quotation_id', 'source', 'bigint UNIQUE REFERENCES ims_quotations(id)'], vendor, project, date,
  ], true, true],
  ['receipts', 'ims_grns', [
    ['purchase_order_id', 'source', 'bigint REFERENCES ims_purchase_orders(id)'], vendor, date,
  ], true, true],
  ['invoices', 'ims_invoices', [
    ['grn_id', 'source', 'bigint UNIQUE REFERENCES ims_grns(id)'], vendor, date,
  ], true, true],
  ['openings', 'ims_opening_stock', [date], true],
  ['issues', 'ims_stock_issues', [
    ['bom_id', 'source', 'bigint REFERENCES ims_boms(id)'], ['project_id', 'project', 'bigint REFERENCES ims_projects(id)'], date,
  ], true],
  ['closings', 'ims_closing_stock', [date], true],
]

function createTables([kind, table, fields, lines, priced]) {
  const snapshot = kind === 'closings'
  return `
    CREATE TABLE ${table} (
      id bigint PRIMARY KEY REFERENCES ims_records(id) ON DELETE CASCADE,
      reference text NOT NULL UNIQUE,
      ${fields.map(([column, , type, optional]) => column + ' ' + type + (optional ? '' : ' NOT NULL')).join(',\n      ')},
      created_by text NOT NULL REFERENCES ims_users(user_id),
      created_at timestamptz NOT NULL
    );
    ${lines ? `
      CREATE TABLE ${table}_lines (
        document_id bigint NOT NULL REFERENCES ${table}(id) ON DELETE CASCADE,
        item_id bigint NOT NULL REFERENCES ims_items(id),
        line_number integer NOT NULL CHECK (line_number > 0),
        quantity numeric(18,3) NOT NULL CHECK (quantity ${snapshot ? '>=' : '>'} 0),
        ${priced ? 'unit_price numeric(18,2) NOT NULL CHECK (unit_price >= 0),' : ''}
        ${snapshot ? 'item_code text NOT NULL, item_name text NOT NULL, unit text NOT NULL,' : ''}
        PRIMARY KEY (document_id, item_id),
        UNIQUE (document_id, line_number)
      );
      CREATE INDEX ${table}_lines_item_idx ON ${table}_lines(item_id);
    ` : ''}
  `
}

function copyRecord([kind, table, fields, lines, priced]) {
  const snapshot = kind === 'closings'
  const columns = fields.map(([column]) => column)
  const values = fields.map(([, key, type]) => "(entry.body->>'" + key + "')::" + type.split(' ')[0])
  return `
    WHEN '${kind}' THEN
      INSERT INTO ${table} (id, reference, ${columns.join(', ')}, created_by, created_at)
      VALUES (entry.id, entry.reference, ${values.join(', ')}, entry.created_by, entry.created_at)
      ON CONFLICT (id) DO UPDATE SET reference = EXCLUDED.reference,
        ${columns.map((column) => column + ' = EXCLUDED.' + column).join(', ')};
      ${lines ? `
        DELETE FROM ${table}_lines WHERE document_id = entry.id;
        INSERT INTO ${table}_lines (document_id, item_id, line_number, quantity${priced ? ', unit_price' : ''}${snapshot ? ', item_code, item_name, unit' : ''})
        SELECT entry.id, (line->>'item')::bigint, position, (line->>'quantity')::numeric
          ${priced ? ", (line->>'price')::numeric" : ''}
          ${snapshot ? ", line->>'code', line->>'name', line->>'unit'" : ''}
        FROM jsonb_array_elements(entry.body->'lines') WITH ORDINALITY AS lines(line, position);
      ` : ''}
      ${['openings', 'receipts', 'issues'].includes(kind) ? `
        INSERT INTO ims_stock_documents (id, kind, document_date)
        VALUES (entry.id, entry.kind, (entry.body->>'date')::date)
        ON CONFLICT (id) DO UPDATE SET document_date = EXCLUDED.document_date;
      ` : ''}
  `
}

function verifyCopy([kind, table, , lines]) {
  return `
    IF EXISTS (
      SELECT 1 FROM ims_records r
      LEFT JOIN ${table} t ON t.id = r.id
      WHERE r.kind = '${kind}' AND (
        t.id IS NULL OR t.reference IS DISTINCT FROM r.reference
        ${lines ? `OR (SELECT count(*) FROM ${table}_lines l WHERE l.document_id = r.id)
          IS DISTINCT FROM jsonb_array_length(r.body->'lines')::bigint` : ''}
      )
    ) THEN
      RAISE EXCEPTION 'IMS migration did not preserve all ${kind} records';
    END IF;
  `
}

export async function migrateInventory(db) {
  await db.query(`
    SELECT pg_advisory_xact_lock(3140322);
    CREATE TABLE IF NOT EXISTS ims_schema_migrations (
      version integer PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    );
  `)
  if ((await db.query('SELECT 1 FROM ims_schema_migrations WHERE version = 1')).rowCount) return

  await db.query(`
    LOCK TABLE ims_records, ims_stock_ledger IN SHARE ROW EXCLUSIVE MODE;
    ${records.map(createTables).join('\n')}
    CREATE TABLE ims_stock_documents (
      id bigint PRIMARY KEY REFERENCES ims_records(id) ON DELETE CASCADE,
      kind text NOT NULL CHECK (kind IN ('openings', 'receipts', 'issues')),
      document_date date NOT NULL,
      opening_id bigint GENERATED ALWAYS AS (CASE WHEN kind = 'openings' THEN id END) STORED REFERENCES ims_opening_stock(id),
      grn_id bigint GENERATED ALWAYS AS (CASE WHEN kind = 'receipts' THEN id END) STORED REFERENCES ims_grns(id),
      issue_id bigint GENERATED ALWAYS AS (CASE WHEN kind = 'issues' THEN id END) STORED REFERENCES ims_stock_issues(id)
    );
    CREATE FUNCTION ims_sync_inventory_record(entry ims_records) RETURNS void LANGUAGE plpgsql AS $$
    BEGIN
      CASE entry.kind
        ${records.map(copyRecord).join('\n')}
        ELSE RAISE EXCEPTION 'Unsupported IMS record kind: %', entry.kind;
      END CASE;
    END;
    $$;
    ${records.map(([kind]) => `SELECT ims_sync_inventory_record(r) FROM ims_records r WHERE r.kind = '${kind}' ORDER BY r.id;`).join('\n')}
    DO $$
    BEGIN
      ${records.map(verifyCopy).join('\n')}
    END;
    $$;
    CREATE FUNCTION ims_sync_inventory_trigger() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF TG_OP = 'UPDATE' AND NEW.kind <> OLD.kind THEN
        RAISE EXCEPTION 'The kind of an IMS record cannot change';
      END IF;
      PERFORM ims_sync_inventory_record(NEW);
      RETURN NEW;
    END;
    $$;
    CREATE TRIGGER ims_sync_inventory
      AFTER INSERT OR UPDATE ON ims_records
      FOR EACH ROW EXECUTE FUNCTION ims_sync_inventory_trigger();
    ALTER TABLE ims_stock_ledger
      ADD CONSTRAINT ims_ledger_item_fk FOREIGN KEY (item_id) REFERENCES ims_items(id),
      ADD CONSTRAINT ims_ledger_document_fk FOREIGN KEY (record_id) REFERENCES ims_stock_documents(id);
    CREATE INDEX ims_grns_order_idx ON ims_grns(purchase_order_id);
    CREATE INDEX ims_boms_project_idx ON ims_boms(project_id);
    CREATE INDEX ims_quotations_vendor_idx ON ims_quotations(vendor_id);
    CREATE INDEX ims_stock_issues_bom_idx ON ims_stock_issues(bom_id);
    CREATE VIEW ims_stock_on_hand AS
      SELECT i.id AS item_id, i.reference AS sku, i.name, i.unit, i.reorder_level,
        COALESCE(SUM(l.quantity), 0) AS quantity
      FROM ims_items i LEFT JOIN ims_stock_ledger l ON l.item_id = i.id
      GROUP BY i.id;
    INSERT INTO ims_schema_migrations (version) VALUES (1);
  `)
}
