import * as duckdb from '@duckdb/duckdb-wasm';

let db: duckdb.AsyncDuckDB | null = null;
let conn: duckdb.AsyncDuckDBConnection | null = null;

function quoteIdent(identifier: string): string {
  return `"${String(identifier).replace(/"/g, '""')}"`;
}

function buildSelectSql(transcriptColumn?: string): string {
  if (!transcriptColumn) {
    return '*';
  }

  if (transcriptColumn === 'transcript') {
    return '*';
  }

  return `*, ${quoteIdent(transcriptColumn)} AS ${quoteIdent('transcript')}`;
}


async function init() {
  if (db) return;

  const bundles = duckdb.getJsDelivrBundles();
  const bundle = await duckdb.selectBundle(bundles);

  const workerUrl = URL.createObjectURL(
    new Blob([`importScripts("${bundle.mainWorker!}");`], { type: 'text/javascript' }),
  );

  const worker = new Worker(workerUrl);
  const logger = new duckdb.ConsoleLogger();
  db = new duckdb.AsyncDuckDB(logger, worker);
  await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
  URL.revokeObjectURL(workerUrl);
}

self.onmessage = async (e: MessageEvent) => {
  const { type, payload, id } = e.data;

  try {
    switch (type) {
      case 'INIT': {
        await init();
        self.postMessage({ id, type: 'INIT_DONE' });
        break;
      }

      case 'PEEK_CSV': {
        await init();
        const { name, buffer } = payload;
        await db!.registerFileBuffer(name, new Uint8Array(buffer));
        conn = await db!.connect();

        await conn.query('DROP TABLE IF EXISTS peek_metadata');
        await conn.insertCSVFromPath(name, {
          name: 'peek_metadata',
          schema: 'main',
          header: true,
          detect: true,
        });

        const schemaResult = await conn.query('DESCRIBE peek_metadata');
        const schema = schemaResult.toArray().map(row => ({
          column_name: row.column_name,
          column_type: row.column_type,
        }));

        await conn.query('DROP TABLE IF EXISTS peek_metadata');
        self.postMessage({ id, type: 'PEEK_DONE', payload: { schema } });
        break;
      }


      case 'READ_CSV': {
        await init();
        const { name, buffer } = payload;
        await db!.registerFileBuffer(name, new Uint8Array(buffer));
        conn = await db!.connect();

        await conn.query('DROP TABLE IF EXISTS read_metadata');
        await conn.insertCSVFromPath(name, {
          name: 'read_metadata',
          schema: 'main',
          header: true,
          detect: true,
        });

        const schemaResult = await conn.query('DESCRIBE read_metadata');
        const schema = schemaResult.toArray().map(row => ({
          column_name: row.column_name,
          column_type: row.column_type,
        }));
        const rowsResult = await conn.query('SELECT * FROM read_metadata');
        const rows = rowsResult.toArray().map(row => {
          const obj: any = {};
          for (const key of Object.keys(row)) {
            const value = row[key];
            obj[key] = typeof value === 'bigint' ? Number(value) : value;
          }
          return obj;
        });

        await conn.query('DROP TABLE IF EXISTS read_metadata');
        self.postMessage({ id, type: 'READ_DONE', payload: { schema, rows } });
        break;
      }

      case 'INGEST_CSV': {
        await init();
        const { name, buffer, mode, joinColumn, transcriptColumn } = payload;
        const selectSql = buildSelectSql(transcriptColumn);
        await db!.registerFileBuffer(name, new Uint8Array(buffer));
        conn = await db!.connect();

        if (mode === 'merge') {
          await conn.query('DROP TABLE IF EXISTS temp_merge_src');
          await conn.query('DROP TABLE IF EXISTS temp_merge');
          await conn.insertCSVFromPath(name, {
            name: 'temp_merge_src',
            schema: 'main',
            header: true,
            detect: true,
          });

          await conn.query(`CREATE OR REPLACE TABLE temp_merge AS SELECT ${selectSql} FROM temp_merge_src`);
          const mergeSql = `
            CREATE OR REPLACE TABLE metadata AS
            SELECT * FROM metadata
            FULL OUTER JOIN temp_merge USING (${quoteIdent(joinColumn)})
          `;
          await conn.query(mergeSql);
          await conn.query('DROP TABLE IF EXISTS temp_merge');
          await conn.query('DROP TABLE IF EXISTS temp_merge_src');
        } else {
          await conn.query('DROP TABLE IF EXISTS temp_import');
          await conn.query('DROP TABLE IF EXISTS metadata');
          await conn.insertCSVFromPath(name, {
            name: 'temp_import',
            schema: 'main',
            header: true,
            detect: true,
          });
          await conn.query(`CREATE OR REPLACE TABLE metadata AS SELECT ${selectSql} FROM temp_import`);
          await conn.query('DROP TABLE IF EXISTS temp_import');
        }

        const schemaResult = await conn.query('DESCRIBE metadata');
        const schema = schemaResult.toArray().map(row => ({
          column_name: row.column_name,
          column_type: row.column_type,
        }));

        self.postMessage({ id, type: 'INGEST_DONE', payload: { schema } });
        break;
      }

      case 'QUERY': {
        if (!conn) throw new Error('Database not initialized or no data ingested');
        const { sql } = payload;
        const result = await conn.query(sql);
        const rows = result.toArray().map(row => {
          const obj: any = {};
          for (const key of Object.keys(row)) {
            const value = row[key];
            obj[key] = typeof value === 'bigint' ? Number(value) : value;
          }
          return obj;
        });
        self.postMessage({ id, type: 'QUERY_DONE', payload: { rows } });
        break;
      }

      default:
        throw new Error(`Unknown message type: ${type}`);
    }
  } catch (error: any) {
    self.postMessage({ id, type: 'ERROR', payload: { message: error.message } });
  }
};
