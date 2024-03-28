import dayjs from 'dayjs';
import { Counter, Gauge, Histogram } from 'prom-client';
import { Server, Socket } from 'socket.io';

import { Coordinates, Database, Location } from './database.mjs';
import { time } from './monitor.mjs';
import { OpenWeather } from './openweather.mjs';
import { WeatherLoader } from './weather_loader.mjs';

const EARTH_RADIUS = 6378137;
const MAX_OFFSET = 2.5;  // +/- 2.5 degrees
const SEARCH_RADIUS = 300000;  // 300km

const requestCounter = new Counter({
  name: 'requests_total',
  help: 'Number of requests to the Becky bot.',
  labelNames: ['endpoint']
});
const responseCounter = new Counter({
  name: 'responses_total',
  help: 'Number of responses sent back from Becky.'
});
const requestDuration = new Histogram({
  name: 'request_duration_seconds',
  help: 'Duration of requests to Becky.',
  labelNames: ['endpoint']
});
const connectionGuage = new Gauge({
  name: 'becky_active_client_connection_count',
  help: 'Number of connections from Becky clients.'
});

enum ErrorCode {
  NOT_FOUND = 404,
  CONFLICT = 409,

  INTERNAL = 500,
  NOT_IMPLEMENTED = 501,
}

interface AddLocationRequest {
  requestId: string;
  name: string;
  lat: number;
  lon: number;
}

interface ListLocationsRequest {
  requestId: string;
}

interface PrecipitationTotals {
  day: number;
  week: number;
  month: number;
}

interface ForecastSummary {
  rain: number;
  snow: number;
}

interface LocationResponse {
  location: Location,
  rain?: PrecipitationTotals;
  snow?: PrecipitationTotals;
  forecast?: ForecastSummary;
}

interface WhereToGoRequest {
  requestId: string;
  where: string;
}

export class BeckyBot {
  private readonly _waitPromise: Promise<void>;
  private _waitResolve: () => void;
  private _waitReject: (err: Error) => void;

  constructor(
    private readonly _db: Database,
    private readonly _server: Server,
    private readonly _loader: WeatherLoader,
    private readonly _weather: OpenWeather
  ) {
    this._waitPromise = new Promise<void>((resolve, reject) => {
      this._waitResolve = resolve;
      this._waitReject = reject;
    });
    this._server.on('connection', (socket) => this._onConnection(socket));
  }

  wait(): Promise<void> { return this._waitPromise; }

  private _onConnection(socket: Socket) {
    connectionGuage.inc();
    socket.on('disconnect', () => connectionGuage.dec());
    new BeckyBotSocket(this._db, socket, this._loader, this._weather);
  }
}

class BeckyBotSocket {
  constructor(
    private readonly _db: Database,
    private readonly _socket: Socket,
    private readonly _loader: WeatherLoader,
    private readonly _weather: OpenWeather
  ) {
    this._socket.onAny((endpoint: string) => requestCounter.inc({ endpoint }));
    this._socket.onAnyOutgoing(() => responseCounter.inc());
    this._socket.on('addLocation', (...args: unknown[]) => {
      time(
        requestDuration,
        { endpoint: 'addLocation' },
        () => this._addLocation.apply(this, args)
      );
    });
    this._socket.on('listLocations', (...args: unknown[]) => {
      time(
        requestDuration,
        { endpoint: 'listLocations' },
        () => this._listLocations.apply(this, args)
      );
    });
    this._socket.on('whereToGo', (...args: unknown[]) => {
      time(
        requestDuration,
        { endpoint: 'whereToGo' },
        () => this._whereToGo.apply(this, args)
      );
    });
  }

  private async _updateForecast(location: Location) {
    // Skip updating if the forecast isn't too old.
    if (location?.oldestForecastTime > dayjs().subtract(2, 'hours').unix()) {
      return;
    }
    const forecast =
      await this._weather.getForecast(location.lat, location.lon);
    if (forecast.hourly) {
      await this._db.setForecast(location.id, forecast.hourly);
    }
  }

  private async _addLocation(req: AddLocationRequest): Promise<void> {
    try {
      await this._db.insertLocation(req);
      this._socket.emit(req.requestId);
      return;
    } catch (err) {
      console.error('Failed to insert location:', req, err);
    }

    try {
      const loc = await this._db.getLocation(req.name);
      this._socket.emit(req.requestId, {
        error: ErrorCode.CONFLICT,
        location: loc
      })
      console.log('Location already existed.', loc);
    } catch (err) {
      console.log('Failed to fetch location by name:', req, err);
      this._socket.emit(req.requestId, { error: ErrorCode.INTERNAL });
    }
  }

  private async _listLocations(req: ListLocationsRequest): Promise<void> {
    try {
      for await (const [loc] of this._db.listLocations()) {
        const location = await this._summarizeWeatherHistory(loc);
        this._socket.emit(`${req.requestId}_location`, location);
      }
      this._socket.emit(req.requestId);
    } catch (err) {
      console.error('Failed listing locations:', err);
      this._socket.emit(req.requestId, { error: ErrorCode.INTERNAL });
    }
  }

  private async _whereToGo({ requestId, where }: WhereToGoRequest) {
    try {
      const [location] = await this._weather.geocodeLocation(where);
      if (!location) {
        this._socket.emit(requestId, {
          error: ErrorCode.NOT_FOUND,
          message: `Failed to geocode "${where}"`
        });
        return;
      }
      console.log(location.name, location.state, location.country);
      const min: Coordinates = {
        lat: location.lat - MAX_OFFSET,
        lon: location.lon - MAX_OFFSET
      };
      const max: Coordinates = {
        lat: location.lat + MAX_OFFSET,
        lon: location.lon + MAX_OFFSET
      };
      for await (const [loc] of this._db.listLocationsWithin(min, max)) {
        if (haversine(location, loc) > SEARCH_RADIUS) continue;
        const locationWithWeather = await this._summarizeWeatherHistory(loc);
        if (badWeatherHistory(locationWithWeather)) continue;
        locationWithWeather.forecast = await this._summarizeForecast(loc);

        this._socket.emit(`${requestId}_location`, locationWithWeather);
      }
      this._socket.emit(requestId);
    } catch (err) {
      console.error('Failed to find where to go:', err);
      this._socket.emit(requestId, { error: ErrorCode.INTERNAL });
    }
  }

  private async _summarizeWeatherHistory(
    loc: Location
  ): Promise<LocationResponse> {
    // Update the stored history. This is a no-op if the history is up to date.
    await this._loader.updateHistory(loc);

    const aDayAgo = dayjs().subtract(1, 'day').unix();
    const aWeekAgo = dayjs().subtract(1, 'week').unix();
    const aMonthAgo = dayjs().subtract(4, 'weeks').unix();
    const rain = {
      day: 0,
      week: 0,
      month: 0
    };
    const snow = {
      day: 0,
      week: 0,
      month: 0
    };
    for await (const [weather] of this._db.listWeather(loc.id, aMonthAgo)) {
      if (weather.time > aDayAgo) {
        rain.day += weather.rain;
        snow.day += weather.snow;
      }
      if (weather.time > aWeekAgo) {
        rain.week += weather.rain;
        snow.week += weather.snow;
      }
      if (weather.time > aMonthAgo) {
        rain.month += weather.rain;
        snow.month += weather.snow;
      }
    }
    const res: LocationResponse = { location: loc };
    if (rain.month) res.rain = rain;
    if (snow.month) res.snow = snow;
    return res;
  }

  private async _summarizeForecast(
    loc: Location
  ): Promise<ForecastSummary | null> {
    await this._updateForecast(loc);

    const summary: ForecastSummary = { rain: 0, snow: 0 };
    const maxTime = dayjs().add(48, 'hours').unix();
    for await (const [hour] of this._db.listForecast(loc.id)) {
      if (hour.time > maxTime) continue;
      summary.rain += hour.rain;
      summary.snow += hour.snow;
    }
    return summary;
  }
}

function toRadians(deg: number): number {
  return deg * (Math.PI / 180);
}

function haversine(a: Coordinates, b: Coordinates): number {
  const φa = toRadians(a.lat);
  const φb = toRadians(b.lat);
  const Δφ = toRadians((b.lat - a.lat));
  const Δλ = toRadians((b.lon - a.lon));

  const n =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φa) * Math.cos(φb) *
    Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(n), Math.sqrt(1 - n));
  return EARTH_RADIUS * c;
}

function badWeatherHistory({ rain, snow }: LocationResponse): boolean {
  if (rain?.day > 10) return true;
  if (snow?.day > 10 || snow?.week > 100) return true;
  return false;
}
