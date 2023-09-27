import { Database } from './database.mjs';
import { WeatherLoader } from './weather_loader.mjs';
import { OpenWeather } from './openweather.mjs';

const BACKFILL_LIMIT = 500;

const db = await Database.open('becky.sqlite');
const loader = new WeatherLoader(db, new OpenWeather());

try {
  await Promise.all([
    loader.fetchAllHistory(),
    loader.backfillHistory(BACKFILL_LIMIT)
  ]);
} catch (err) {
  console.error('Failed to fetch history:', err);
}
