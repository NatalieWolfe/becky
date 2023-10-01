import { promises as fs } from 'node:fs';
import postgres, { PendingQuery, Sql } from 'postgres';

import { CurrentWeather, HourWeather } from './openweather.mjs';
import { getSecret } from './secret.mjs';

export interface Coordinates {
  lat: number;
  lon: number;
}

export interface LocationPartial {
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

export interface LocationWeather {
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

export type WeatherBlob = WeatherBlobV1;

interface ForecastBlobV1 {
  version: 1;
  forecast: HourWeather[]
}

type ForecastBlob = ForecastBlobV1;

interface InsertResult {
  lastId: number;
}

interface UpdateResult {
  affectedRowCount: number;
}

const DATABASE = 'becky';
const GRACEFUL_SHUTDOWN_SECONDS = 10;
const SCHEMA_VERSION = 2;
const SCHEMA_DIR = './src/schema';

function selectLocationQuery(sql: Sql): PendingQuery<Location[]> {
  return sql`
    SELECT
      l.location_id AS id,
      l.name,
      l.lat,
      l.lon,
      history.weather_time AS last_weather_time,
      forecast.forecast_time AS oldest_forecast_time
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
}

export class Database {
  private constructor(private readonly _sql: Sql) {}

  static async open(database = DATABASE): Promise<Database> {
    const db = new Database(postgres({
      database,
      password: await getSecret('postgres_password'),
      transform: { column: { from: postgres.toCamel } }
    }));
    await db._initialize();
    return db;
  }

  async close() {
    await this._sql.end({timeout: GRACEFUL_SHUTDOWN_SECONDS});
  }

  listLocations(): AsyncIterable<Location[]> {
    return selectLocationQuery(this._sql).cursor();
  }

  listLocationsWithin(
    lowCorner: Coordinates,
    highCorner: Coordinates
  ): AsyncIterable<Location[]> {
    return this._sql<Location[]>`
      ${selectLocationQuery(this._sql)}
      WHERE l.lat > ${lowCorner.lat} AND l.lat < ${highCorner.lat}
      AND l.lon > ${lowCorner.lon} AND l.lon < ${highCorner.lon}
    `.cursor();
  }

  async getLocation(idOrName: string): Promise<Location> {
    // IDs are `lat,lon` fixed to 2 decimals of precision.
    const sql = this._sql;
    const isId = /^-?\d+\.\d\d,-?\d+\.\d\d$/.test(idOrName);
    const results = await sql<Location[]>`
      ${selectLocationQuery(sql)}
      WHERE ${isId ? sql`location_id` : sql`name`} = ${idOrName}
      LIMIT 1
    `;
    return results[0];
  }

  async insertLocation(location: LocationPartial): Promise<void> {
    const locationId = _toId(location.lat, location.lon);
    await this._sql`
      INSERT INTO locations (location_id, name, lat, lon)
      VALUES (
        ${locationId},
        ${location.name},
        ${location.lat},
        ${location.lon}
      )
    `
  }

  listWeather(
    locationId: string,
    oldestTime: number
  ): AsyncIterable<LocationWeather[]> {
    return this._sql<LocationWeather[]>`
      SELECT
        location_id,
        weather_time AS time,
        rain_mm AS rain,
        snow_mm AS snow
      FROM weather_hourly_history
      WHERE location_id = ${locationId}
      AND weather_time >= ${oldestTime}
    `.cursor();
  }

  /** Fetches the Unix timestamp of the oldest forecast at the location. */
  async getOldestForecast(locationId: string): Promise<number> {
    const res = await this._sql<{weatherTime: number}[]>`
      SELECT weather_time
      FROM weather_hourly_history
      WHERE location_id = ${locationId}
      ORDER BY weather_time ASC
      LIMIT 1
    `;
    return res[0]?.weatherTime;
  }

  async insertWeatherHistory(
    locationId: string,
    time: number,
    weather: CurrentWeather
  ): Promise<void> {
    await this._sql`
      INSERT INTO weather_hourly_history (
        location_id,
        weather_time,
        weather,
        temperature,
        rain_mm,
        snow_mm
      ) VALUES (
        ${locationId},
        ${time},
        ${this._sql.json({version: 1, current: weather})},
        ${weather.temp},
        ${weather.rain?.['1h'] ?? 0},
        ${weather.snow?.['1h'] ?? 0}
      )
    `;
  }

  listForecast(locationId: string): AsyncIterable<LocationForecast[]> {
    return this._sql<LocationForecast[]>`
      SELECT
        location_id,
        forecast_time AS time,
        rain_mm AS rain,
        snow_mm AS snow
      FROM weather_hourly_forecast
      WHERE location_id = ${locationId}
      ORDER BY forecast_time ASC
    `.cursor();
  }

  async setForecast(
    locationId: string,
    forecast: HourWeather[]
  ): Promise<void> {
    try {
      await this._sql.begin(async (sql: Sql) => {
        await sql`
          DELETE FROM weather_hourly_forecast WHERE location_id = ${locationId}
        `;
        await sql`
          INSERT INTO weather_hourly_forecast
          ${sql(forecast.map((hour) => ({
            location_id: locationId,
            forecast_time: hour.dt,
            forecast: sql.json({version: 1, forecast: hour}),
            temperature: hour.temp,
            rain_mm: hour.rain?.['1h'] ?? 0,
            snow_mm: hour.snow?.['1h'] ?? 0
          })))}
        `;
      });
    } catch (err) {
      console.error('Failed to update forecast for', locationId, err);
      throw err;
    }
  }

  private async _initialize(): Promise<void> {
    const schemaVersion = await this._schemaVersion();
    for (let i = schemaVersion; i < SCHEMA_VERSION; ++i) {
      await this._updateSchema(i + 1);
    }
  }

  private async _schemaVersion(): Promise<number> {
    const table_check = await this._sql<{tableExists: boolean}[]>`
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_name = 'becky_schema'
      ) AS table_exists
    `;
    if (!table_check[0]?.tableExists) return 0;

    const results = await this._sql<{version: number}[]>`
        SELECT version FROM becky_schema
    `;
    return results[0]?.version ?? 0;
  }

  private async _updateSchema(i: number): Promise<void> {
    const versionFile =
      await fs.readFile(`${SCHEMA_DIR}/version-${i}.sql`, {encoding: 'utf8'});
    console.log(versionFile);
    await this._sql.unsafe(versionFile);
  }
}

function _toId(lat: number, lon: number) {
  return `${lat.toFixed(2)},${lon.toFixed(2)}`;
}
