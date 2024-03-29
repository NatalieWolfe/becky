import axios from 'axios';
import { Histogram } from 'prom-client';

import { logger } from './logging.mjs';
import { time } from './monitor.mjs';
import { getSecret } from './secret.mjs';

export const MAX_VISIBILITY = 10000;
const OPENWEATHER_HOST = 'api.openweathermap.org';

const openweatherDuration = new Histogram({
  name: 'openweather_request_duration_seconds',
  help: 'Duration of API calls to OpenWeather.',
  labelNames: ['endpoint']
});

type Timestamp = number;
type Percent100 = number; // 0 - 100
type Percent1 = number;   // 0.0 - 1.0
type Meters = number;
type Millimeters = number;
type MMPerHour = number;

interface WeatherCondition {
  id: number;
  main: string;
  description: string;
  icon: string;
}

interface WeatherBase {
  dt: Timestamp;
  pressure: number;
  humidity: Percent100;
  dew_point: number;
  clouds: Percent100;
  uvi: number;
  wind_speed: number;
  wind_gust?: number;
  wind_deg: number;
  weather: [WeatherCondition];

  toJSON: () => Object;
}

export interface CurrentWeather extends WeatherBase {
  dt: Timestamp;
  sunrise: Timestamp;
  sunset: Timestamp;
  temp: number;
  feels_like: number;
  visibility: Meters;
  rain?: { '1h': MMPerHour; };
  snow?: { '1h': MMPerHour; };
}

interface MinuteWeather {
  dt: Timestamp;
  precipitation: number;
}

export interface HourWeather extends WeatherBase {
  temp: number;
  feels_like: number;
  visibility: Meters;
  pop: Percent1;
  rain?: { '1h': MMPerHour; };
  snow?: { '1h': MMPerHour; };
}

interface DayWeather extends WeatherBase {
  sunrise: Timestamp;
  sunset: Timestamp;
  moonrise: Timestamp;
  moonset: Timestamp;
  // 0, 1: New; 0.25: First Quarter; 0.5: Full; 0.75: Second Quarter
  moon_phase: number;
  temp: {
    morn: number;
    day: number;
    eve: number;
    night: number;
    min: number;
    max: number;
  };
  feels_like: {
    morn: number;
    day: number;
    eve: number;
    night: number;
  };
  pop: Percent1;
  rain?: Millimeters;
  snow?: Millimeters;
}

interface WeatherAlert {
  sender_name: string;
  event: string;
  start: Timestamp;
  end: Timestamp;
  description: string;
  tags: string[];
}

export interface ForecastResponse {
  lat: number;
  lon: number;
  timezone: string;
  timezone_offset: number;
  current?: CurrentWeather;
  minutely?: MinuteWeather[];
  hourly?: HourWeather[];
  daily?: DayWeather[];
  alerts?: WeatherAlert[];
}

export interface HistoryResponse {
  lat: number;
  lon: number;
  timezone: string;
  timezone_offset: number;
  data: [CurrentWeather];
}

interface GeocodeResponse {
  name: string;
  lat: number;
  lon: number;
  country: string;
  state?: string;
  local_names: {
    [languageCode: string]: string;
    ascii: string;
    feature_name: string;
  };
}

export class OpenWeather {
  getForecast(
    lat: number,
    lon: number
  ): Promise<ForecastResponse> {
    return this._callApi<ForecastResponse>(
      '/data/3.0/onecall',
      { lat, lon, exclude: 'current,minutely' }
    );
  }

  getHistorical(
    lat: number,
    lon: number,
    dt: number
  ): Promise<HistoryResponse> {
    return this._callApi<HistoryResponse>(
      '/data/3.0/onecall/timemachine',
      { lat, lon, dt }
    );
  }

  geocodeLocation(query: string): Promise<GeocodeResponse[]> {
    return this._callApi<GeocodeResponse[]>(
      '/geo/1.0/direct',
      { q: query, limit: 1 }
    );
  }

  private async _callApi<T>(endpoint: string, params: any): Promise<T> {
    logger.info('Calling OpenWeather', { endpoint });
    return await time(openweatherDuration, { endpoint }, async () => {
      const appid = await getSecret('openweather_api_key');
      params.appid = appid;
      params.units = 'metric';
      const res = await axios.get<T>(
        `https://${OPENWEATHER_HOST}${endpoint}`,
        { params }
      );
      if (res.status === 200) return res.data;
      console.error(res.status, res.data);
      throw new Error(`Failed to get ${endpoint}: ${res.status}`);
    });
  }
}
