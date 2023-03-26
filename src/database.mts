import { promises as fs } from 'node:fs';
import sqlite from 'sqlite3';

import { CurrentWeather } from './openweather.mjs';

type Parameter = number | string;

const SCHEMA_VERSION = 1;
const SCHEMA_DIR = './src/schema';

interface LocationPartial {
  name: string;
  lat: number;
  lon: number;
}

interface Location extends LocationPartial {
  id: string;
  name: string;
  lat: number;
  lon: number;
  lastWeatherTime?: number;
}

interface WeatherBlobV1 {
  version: 1;
  current: CurrentWeather;
}

type WeatherBlob = WeatherBlobV1;

interface InvertedPromise<T> {
  promise: Promise<IteratorResult<T>>;
  resolve: (row: IteratorResult<T>) => void;
  reject: (err: Error) => void;
}

class EachRowIterator<T> implements AsyncIterator<T> {
  private readonly _nextPromises: InvertedPromise<T>[] = [];
  private readonly _eachPromises: InvertedPromise<T>[] = [];

  constructor(
    db: sqlite.Database,
    query: string,
    params?: Parameter[]
  ) {
    this._addPromise();
    db.each<T>(query, params, this._each.bind(this), this._end.bind(this));
  }

  next(): Promise<IteratorResult<T>> {
    return this._nextPromises.shift().promise;
  }

  private _each(err: Error, row: T) {
    this._addPromise();
    if (err) {
      this._eachPromises.shift().reject(err);
    } else {
      this._eachPromises.shift().resolve({value: row, done: false});
    }
  }

  private _end(err: Error) {
    if (err) {
      this._eachPromises.shift().reject(err);
    } else {
      this._eachPromises.shift().resolve({value: null, done: true});
    }
  }

  private _addPromise() {
    const prom = {
      promise: null,
      resolve: null,
      reject: null,
    } as InvertedPromise<T>;
    prom.promise = new Promise<IteratorResult<T>>((resolve, reject) => {
      prom.resolve = resolve;
      prom.reject = reject;
    });
    this._nextPromises.push(prom);
    this._eachPromises.push(prom);
  }
}

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

  listLocations(): AsyncIterable<Location> {
    return this._each<Location>(`
      SELECT
        l.location_id AS id,
        l.name,
        l.lat,
        l.lon,
        latest.weather_time AS lastWeatherTime
      FROM locations AS l
      LEFT JOIN (
        SELECT location_id, MAX(weather_time) AS weather_time
        FROM weather_hourly_history
        GROUP BY location_id
      ) AS latest USING (location_id)
    `);
  }

  async getLocation(idOrName: string): Promise<Location> {
    // IDs are `lat,lon` fixed to 2 decimals of precision.
    const isId = /^-?\d+\.\d\d,-?\d+\.\d\d$/.test(idOrName);
    return this._get<Location>(`
      SELECT
        l.location_id AS id,
        l.name,
        l.lat,
        l.lon,
        latest.weather_time AS lastWeatherTime
      FROM locations AS l
      LEFT JOIN (
        SELECT location_id, MAX(weather_time) AS weather_time
        FROM weather_hourly_history
        GROUP BY location_id
      ) AS latest USING (location_id)
      WHERE ${isId ? 'location_id' : 'name'} = ?
      LIMIT 1
    `, [idOrName]);
  }

  async insertLocation(location: LocationPartial): Promise<void> {
    const locationId = _toId(location.lat, location.lon);
    return this._run(`
      INSERT INTO locations (location_id, name, lat, lon)
      VALUES ( ?, ?, ?, ? )
    `, [locationId, location.name, location.lat, location.lon]);
  }

  async insertWeatherHistory(
    locationId: string,
    time: number,
    weather: CurrentWeather
  ): Promise<void> {
    await this._run(`
      INSERT INTO weather_hourly_history (
        location_id,
        weather_time,
        weather,
        temperature,
        rain_mm,
        snow_mm
      ) VALUES ( ?, ?, ?, ?, ?, ? )
    `, [
      locationId,
      time,
      JSON.stringify({version: 1, current: weather}),
      weather.temp,
      weather.rain?.['1h'] || 0,
      weather.snow?.['1h'] || 0
    ]);
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

  _each<T>(query: string, params?: Parameter[]): AsyncIterable<T> {
    return {
      [Symbol.asyncIterator]:
        () => new EachRowIterator<T>(this._db, query, params)
    };
  }

  _exec(query: string): Promise<void> {
    return _toPromise((cb) => this._db.exec(query, cb));
  }

  _get<T>(query: string, params?: Parameter[]): Promise<T> {
    return _toPromise<T>((cb) => this._db.get<T>(query, params, cb));
  }

  _run(query: string, params?: Parameter[]): Promise<void> {
    return _toPromise((cb) => this._db.run(query, params, cb));
  }

  async _updateSchema(i: number): Promise<void> {
    const versionFile =
      await fs.readFile(`${SCHEMA_DIR}/version-${i}.sql`, {encoding: 'utf8'});
    console.log(versionFile);
    await this._exec(versionFile);
  }
}

function _toId(lat: number, lon: number) {
  return `${lat.toFixed(2)},${lon.toFixed(2)}`;
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
