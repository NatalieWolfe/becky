import dayjs from 'dayjs';
import { promises as fs } from 'node:fs';
import sqlite from 'sqlite3';

import { CurrentWeather, HourWeather } from './openweather.mjs';

type Parameter = number | string;

export interface Coordinates {
  lat: number;
  lon: number;
}

interface LocationPartial {
  name: string;
  lat: number;
  lon: number;
}

export interface Location extends LocationPartial {
  id: string;
  name: string;
  lat: number;
  lon: number;
  lastWeatherTime?: number;
  oldestForecastTime?: number;
}

interface LocationWeather {
  locationId: string;
  time: number;
  rain: number;
  snow: number;
}

interface LocationForecast {
  locationId: string;
  time: number;
  rain: number;
  snow: number;
}

interface WeatherBlobV1 {
  version: 1;
  current: CurrentWeather;
}

type WeatherBlob = WeatherBlobV1;

interface ForecastBlobV1 {
  version: 1;
  forecast: HourWeather[]
}

type ForecastBlob = ForecastBlobV1;

interface InvertedPromise<T> {
  promise: Promise<IteratorResult<T>>;
  resolve: (row: IteratorResult<T>) => void;
  reject: (err: Error) => void;
}

interface InsertResult {
  lastId: number;
}

interface UpdateResult {
  affectedRowCount: number;
}

const SCHEMA_VERSION = 2;
const SCHEMA_DIR = './src/schema';
const SELECT_LOCATION_QUERY = `
  SELECT
    l.location_id AS id,
    l.name,
    l.lat,
    l.lon,
    history.weather_time AS lastWeatherTime,
    forecast.forecast_time AS oldestForecastTime
  FROM locations AS l
  LEFT JOIN (
    SELECT location_id, MAX(weather_time) AS weather_time
    FROM weather_hourly_history
    GROUP BY location_id
  ) AS history USING (location_id)
  LEFT JOIN (
    SELECT location_id, MIN(forecast_time) AS forecast_time
    FROM weather_hourly_forecast
    GROUP BY location_id
  ) AS forecast USING (location_id)
`;

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
    return this._each<Location>(SELECT_LOCATION_QUERY);
  }

  listLocationsWithin(
    lowCorner: Coordinates,
    highCorner: Coordinates
  ): AsyncIterable<Location> {
    return this._each<Location>(`
      ${SELECT_LOCATION_QUERY}
      WHERE l.lat > ? AND l.lat < ?
      AND l.lon > ? AND l.lon < ?
    `, [lowCorner.lat, highCorner.lat, lowCorner.lon, highCorner.lon]);
  }

  getLocation(idOrName: string): Promise<Location> {
    // IDs are `lat,lon` fixed to 2 decimals of precision.
    const isId = /^-?\d+\.\d\d,-?\d+\.\d\d$/.test(idOrName);
    return this._get<Location>(`
      ${SELECT_LOCATION_QUERY}
      WHERE ${isId ? 'location_id' : 'name'} = ?
      LIMIT 1
    `, [idOrName]);
  }

  async insertLocation(location: LocationPartial): Promise<void> {
    const locationId = _toId(location.lat, location.lon);
    await this._run<InsertResult>(`
      INSERT INTO locations (location_id, name, lat, lon)
      VALUES ( ?, ?, ?, ? )
    `, [locationId, location.name, location.lat, location.lon]);
  }

  listWeather(
    locationId: string,
    oldestTime: number
  ): AsyncIterable<LocationWeather> {
    return this._each<LocationWeather>(`
      SELECT
        location_id AS locationId,
        weather_time AS time,
        rain_mm AS rain,
        snow_mm AS snow
      FROM weather_hourly_history
      WHERE location_id = ?
      AND weather_time >= ?
    `, [locationId, oldestTime]);
  }

  async getOldestForecast(locationId: string): Promise<number> {
    const res = await this._get<{weather_time: number}>(`
      SELECT weather_time
      FROM weather_hourly_history
      WHERE location_id = ?
      ORDER BY weather_time ASC
      LIMIT 1
    `, [locationId]);
    return res.weather_time;
  }

  async insertWeatherHistory(
    locationId: string,
    time: number,
    weather: CurrentWeather
  ): Promise<void> {
    await this._run<InsertResult>(`
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

  listForecast(locationId: string): AsyncIterable<LocationForecast> {
    return this._each<LocationForecast>(`
      SELECT
        location_id AS locationId,
        forecast_time AS time,
        rain_mm AS rain,
        snow_mm AS snow
      FROM weather_hourly_forecast
      WHERE location_id = ?
      ORDER BY forecast_time ASC
    `);
  }

  async setForecast(
    locationId: string,
    forecast: HourWeather[]
  ): Promise<void> {
    try {
      await this._serialize(() => {
        const promises: Promise<any>[] = [];
        promises.push(this._exec('BEGIN IMMEDIATE TRANSACTION'));
        promises.push(this._run(
          'DELETE FROM weather_hourly_forecast WHERE location_id = ?',
          [locationId]
        ));
        for (const hour of forecast) {
          promises.push(this._run(`
            INSERT INTO weather_hourly_forecast (
              location_id,
              forecast_time,
              forecast,
              temperature,
              rain_mm,
              snow_mm
            ) VALUES ( ?, ?, ?, ?, ?, ? )
          `, [
            locationId,
            hour.dt,
            JSON.stringify({version: 1, forecast: hour}),
            hour.temp,
            hour.rain?.['1h'] || 0,
            hour.snow?.['1h'] || 0
          ]));
        }
        promises.push(this._exec('COMMIT TRANSACTION'));
        return promises;
      });
    } catch (err) {
      console.error('Failed to update forecast for', locationId, err);
      await this._exec('ROLLBACK TRANSACTION');
    }
  }

  private async _initialize(): Promise<void> {
    const schemaVersion = await this._schemaVersion();
    for (let i = schemaVersion; i < SCHEMA_VERSION; ++i) {
      await this._updateSchema(i + 1);
    }
  }

  private async _schemaVersion(): Promise<number> {
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

  private _each<T>(query: string, params?: Parameter[]): AsyncIterable<T> {
    return {
      [Symbol.asyncIterator]:
        () => new EachRowIterator<T>(this._db, query, params)
    };
  }

  private _exec(query: string): Promise<void> {
    return _toPromise((cb) => this._db.exec(query, cb));
  }

  private _get<T>(query: string, params?: Parameter[]): Promise<T> {
    return _toPromise<T>((cb) => this._db.get<T>(query, params, cb));
  }

  private _run<T extends (InsertResult | UpdateResult)>(
    query: string,
    params?: Parameter[]
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      // Must use old-school inline function to get proper `this` value.
      this._db.run(query, params, function (err) {
        if (err) {
          reject(err);
        } else if (typeof this.lastID === 'number') {
          resolve({lastId: this.lastID} as T);
        } else {
          resolve({affectedRowCount: this.changes} as T);
        }
      });
    });
  }

  private async _serialize(f: () => Promise<any>[]): Promise<void> {
    let promises = [];
    this._db.serialize(() => { promises = f(); });
    await Promise.all(promises);
  }

  private async _updateSchema(i: number): Promise<void> {
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
