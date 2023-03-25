import axios from 'axios';

import { getSecret } from './secret.mjs';

const OPENWEATHER_HOST = 'api.openweathermap.org';

type Timestamp = number;
type Percent100 = number; // 0 - 100
type Percent1 = number;   // 0.0 - 1.0
type Meters = number;
type Millimeters = number;

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
}

interface CurrentWeather extends WeatherBase {
  dt: Timestamp;
  sunrise: Timestamp;
  sunset: Timestamp;
  temp: number;
  feels_like: number;
  visibility: Meters;
  rain?: { '1h': number; };
  snow?: { '1h': number; };
}

interface MinuteWeather {
  dt: Timestamp;
  precipitation: number;
}

interface HourWeather extends WeatherBase {
  temp: number;
  feels_like: number;
  visibility: Meters;
  pop: Percent1;
  rain?: { '1h': number; };
  snow?: { '1h': number; };
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

export interface WeatherResponse {
  lat: number;
  lon: number;
  timezone: string;
  timezone_offset: number;
  current: CurrentWeather;
  minutely: MinuteWeather[];
  hourly: HourWeather[];
  daily: DayWeather[];
  alerts?: WeatherAlert[];
}

export async function getForecast(
  lat: number,
  lon: number
): Promise<WeatherResponse> {
  const appid = await getSecret('openweather_api_key');
  const res = await axios.get<WeatherResponse>(
    `https://${OPENWEATHER_HOST}/data/3.0/onecall`,
    { params: { lat, lon, appid } }
  );
  if (res.status === 200) return res.data;
  console.error(res.status, res.data);
  throw new Error(`Failed to get forecast: ${res.status}`);
}
