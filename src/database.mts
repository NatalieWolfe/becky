import { promises as fs } from 'node:fs';
import sqlite, { SCHEMA } from 'sqlite3';

type Parameter = number | string;

const SCHEMA_VERSION = 1;
const SCHEMA_DIR = './src/schema';

export class Database {
  private constructor(private readonly _db: sqlite.Database) {}

  static async open(dbname: string): Promise<Database> {
    const db = await new Promise<Database>((resolve, reject) => {
      const sqliteDb = new sqlite.Database(dbname, (err) => {
        if (err) {
          reject(err);
        } else {
          resolve(new Database(sqliteDb));
        }
      });
    });

    await db._initialize();
    return db;
  }

  close(): Promise<void> {
    return _toPromise((cb) => this._db.close(cb));
  }

  async _initialize(): Promise<void> {
    const schemaVersion = await this._schemaVersion();
    for (let i = schemaVersion; i < SCHEMA_VERSION; ++i) {
      await this._updateSchema(i + 1);
    }
  }

  async _schemaVersion(): Promise<number> {
    const pragmaVersion = (
      await this._get<{schema_version: number}>('PRAGMA schema_version')
    ).schema_version;
    if (!pragmaVersion) return 0;

    try {
      return (
        await this._get<{version: number}>('SELECT version FROM becky_schema')
      ).version;
    } catch (e) {
      if (/no such table.*becky_schema/i.test(e.message)) {
        return 0;
      }
      throw e;
    }
  }

  _exec(query: string): Promise<void> {
    return _toPromise((cb) => this._db.exec(query, cb));
  }

  _get<T>(query: string, params?: Parameter[]): Promise<T> {
    return _toPromise<T>((cb) => this._db.get<T>(query, params, cb));
  }

  async _updateSchema(i: number): Promise<void> {
    const versionFile =
      await fs.readFile(`${SCHEMA_DIR}/version-${i}.sql`, {encoding: 'utf8'});
    console.log(versionFile);
    await this._exec(versionFile);
  }
}

function _toPromise<T = void>(
  func: (cb: (err: any, val: T) => void) => void
): Promise<T> {
  return new Promise((resolve, reject) => {
    func(_toCallback<T>(resolve, reject));
  });
}

function _toCallback<T = void>(
  resolve: (val: T) => void,
  reject: (err: any) => void
): (err: any, val: T) => void {
  return (err: any, val: T) => {
    if (err) {
      reject(err);
    } else {
      resolve(val);
    }
  }
}
