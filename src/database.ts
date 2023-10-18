import {Database as BunDatabase} from 'bun:sqlite';

type LastRowId = {
  'LAST_INSERT_ROWID()': number;
};

export class Database extends BunDatabase {
  constructor(filename?: string) {
    super(filename, {create: true});
    this.exec('PRAGMA journal_mode = WAL;');
    this.exec('PRAGMA foreign_keys;');
  }

  createTable(name: string, columns: string[]) {
    const sqlQuery = `CREATE TABLE ${name}(\n${columns.join(',\n')}\n);`;
    this.query(sqlQuery).run();
  }

  insert(tableName: string, data: Record<string, any>) {
    const columns = Object.keys(data);
    const sqlQuery = `INSERT INTO ${tableName} (${columns.join(
      ', '
    )}) VALUES (${Array(columns.length).fill('?').join(', ')});`;
    const values = columns.map(key => data[key]);
    this.query(sqlQuery).run(...values);

    const rowId: LastRowId = this.query(
      'SELECT LAST_INSERT_ROWID();'
    ).get() as LastRowId;
    return rowId['LAST_INSERT_ROWID()'];
  }

  select(tableName: string, columns: string | string[] = '*') {
    if (Array.isArray(columns)) {
      columns = columns.join(', ');
    }
    const sqlQuery = `SELECT ${columns} FROM ${tableName};`;
    return this.query(sqlQuery).all();
  }

  close() {
    this.exec('PRAGMA wal_checkpoint(TRUNCATE);');
    super.close();
  }
}
