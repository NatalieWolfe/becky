import { Database } from './database.mjs';
import { Monitor } from './monitor.mjs';
import { OpenWeather } from './openweather.mjs';
import { WeatherLoader } from './weather_loader.mjs';

const BACKFILL_LIMIT = 500;

const monitor = new Monitor({ labels: { app: 'scraper' } });
const db = await Database.open();
const loader = new WeatherLoader(db, new OpenWeather());

try {
  await Promise.all([
    loader.fetchAllHistory(),
    loader.backfillHistory(BACKFILL_LIMIT)
  ]);
} catch (err) {
  console.error('Failed to fetch history:', err);
}

await db.close();
await monitor.close();
