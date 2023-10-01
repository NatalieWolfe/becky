import postgres from 'postgres';
import sqlite from 'sqlite3';

import { Database, LocationPartial, WeatherBlob } from './database.mjs';
import { CurrentWeather } from './openweather.mjs';

const { PostgresError } = postgres;

// https://www.postgresql.org/docs/current/errcodes-appendix.html
enum PgErrorCode {
  UNIQUE_VIOLATION = '23505'
}

const SQLITE_DB_PATH = process.env['SQLITE_DB_PATH'] ?? 'becky.sqlite';

// -------------------------------------------------------------------------- //

// Everything in this section was copied from the database module before porting
// it to Postgres.

type Parameter = number | string;
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

function each<T>(
  dblite: sqlite.Database,
  query: string,
  params?: Parameter[]
): AsyncIterable<T> {
  return {
    [Symbol.asyncIterator]:
      () => new EachRowIterator<T>(dblite, query, params)
  };
}

function toPromise<T = void>(
  func: (cb: (err: any, val: T) => void) => void
): Promise<T> {
  return new Promise((resolve, reject) => {
    func(toCallback<T>(resolve, reject));
  });
}

function toCallback<T = void>(
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

// -------------------------------------------------------------------------- //

// Below here is new code for the migration.

interface LocationRow extends LocationPartial {
  id: string;
}
function listLocations(dblite: sqlite.Database): AsyncIterable<LocationRow> {
  return each<LocationRow>(dblite, `
    SELECT
      l.location_id AS id,
      l.name,
      l.lat,
      l.lon
    FROM locations AS l
  `);
}

async function* listWeather(
  dblite: sqlite.Database,
  locationId: string,
): AsyncIterable<{timestamp: number, weather: CurrentWeather}> {
  interface Row { timestamp: number; blob: string; }
  for await (const {timestamp, blob} of each<Row>(dblite, `
    SELECT
      weather_time AS timestamp,
      weather AS blob
    FROM weather_hourly_history
    WHERE location_id = ?
  `, [locationId])) {
    const weather = JSON.parse(blob) as WeatherBlob;
    if (weather.version === 1) yield {timestamp, weather: weather.current};
  }
}

function isUniqueViolation(e: any): boolean {
  return e instanceof PostgresError && e.code === PgErrorCode.UNIQUE_VIOLATION;
}

const db = await Database.open();
const dblite = await (new Promise<sqlite.Database>((resolve, reject) => {
  const dblite = new sqlite.Database(SQLITE_DB_PATH, (err) => {
    err ? reject(err) : resolve(dblite);
  });
}));

// Copy over every location.
const locationIds = new Set<string>();
for await (const location of listLocations(dblite)) {
  console.log('Inserting', location.name, location.id);
  try {
    await db.insertLocation(location);
  } catch (err) {
    if (isUniqueViolation(err)) {
      console.log('Duplicate location.');
    } else {
      throw err;
    }
  }
  locationIds.add(location.id);
}

// Copy over every bit of weather history.
for (const locationId of locationIds) {
  for await (const {timestamp, weather} of listWeather(dblite, locationId)) {
    console.log('Inserting history for', locationId, timestamp);
    try {
      await db.insertWeatherHistory(locationId, timestamp, weather)
    } catch (err) {
      if (isUniqueViolation(err)) {
        console.log('Duplicate history.');
      } else {
        throw err;
      }
    }
  }
}

// Not bothering with forecasts since they are ephemeral anyway.
await db.close();
await toPromise((cb) => dblite.close(cb));
