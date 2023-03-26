import dayjs from 'dayjs';
import { Socket } from 'socket.io-client';

import { Database, Location } from './database.mjs';

enum ErrorCode {
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

interface LocationResponse {
  location: Location,
  rain?: PrecipitationTotals;
  snow?: PrecipitationTotals;
}

interface WhereToGoRequest {
  requestId: string;
}

export class BeckyBot {
  private readonly _waitPromise: Promise<void>;
  private _waitResolve: () => void;
  private _waitReject: (err: Error) => void;

  constructor(
    private readonly _db: Database,
    private readonly _socket: Socket
  ) {
    this._waitPromise = new Promise<void>((resolve, reject) => {
      this._waitResolve = resolve;
      this._waitReject = reject;
    });

    this._socket.on('addLocation', this._addLocation.bind(this));
    this._socket.on('listLocations', this._listLocations.bind(this));
    this._socket.on('whereToGo', this._whereToGo.bind(this));
  }

  wait(): Promise<void> { return this._waitPromise; }

  async _addLocation(req: AddLocationRequest): Promise<void> {
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

  async _listLocations(req: ListLocationsRequest): Promise<void> {
    try {
      for await (const loc of this._db.listLocations()) {
        const location = await this._summarizeWeatherHistory(loc);
        this._socket.emit(`${req.requestId}_location`, location);
      }
      this._socket.emit(req.requestId);
    } catch (err) {
      console.error('Failed listing locations:', err);
      this._socket.emit(req.requestId, { error: ErrorCode.INTERNAL });
    }
  }

  _whereToGo(req: WhereToGoRequest) {
    this._socket.emit(req.requestId, {error: ErrorCode.NOT_IMPLEMENTED});
  }

  async _summarizeWeatherHistory(loc: Location): Promise<LocationResponse> {
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
    for await (const weather of this._db.listWeather(loc.id, aMonthAgo)) {
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
    const res: LocationResponse = {location: loc};
    if (rain.month) res.rain = rain;
    if (snow.month) res.snow = snow;
    return res;
  }
}
