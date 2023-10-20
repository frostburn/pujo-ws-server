import pg from 'pg';

export class Client extends pg.Client {
  async createTable(name, columns) {
    const sqlQuery = `CREATE TABLE ${name}(\n${columns.join(',\n')}\n);`;
    return await this.query(sqlQuery);
  }

  async createEnum(name, choices) {
    const sqlQuery = `CREATE TYPE ${name} AS ENUM (\n${choices
      .map(c => `'${c}'`)
      .join(',\n')}\n);`;
    return await this.query(sqlQuery);
  }

  async insert(tableName, data) {
    const columns = Object.keys(data);
    const placeholders = [...Array(columns.length).keys()]
      .map(i => `$${i + 1}`)
      .join(', ');
    const sqlQuery = `INSERT INTO ${tableName}(${columns.join(
      ', '
    )}) VALUES(${placeholders});`;
    console.log(sqlQuery);
    const values = columns.map(key => data[key]);
    console.log(values);

    return await this.query({text: sqlQuery, values});
    /*
    const query = new pg.Query(sqlQuery, values);
    const result = this.query(query);
    console.log(result);

    result.on('error', e => console.error(e));
    result.on('row', r => console.log('row', r));

    result.submit();

    return result;
    */

    /*
    const rowId: LastRowId = this.query(
      'SELECT LAST_INSERT_ROWID();'
    ).get() as LastRowId;
    return rowId['LAST_INSERT_ROWID()'];
    */
  }

  async select(tableName, columns = '*') {
    if (Array.isArray(columns)) {
      columns = columns.join(', ');
    }
    const sqlQuery = `SELECT ${columns} FROM ${tableName};`;
    return await this.query(sqlQuery);
  }
}
