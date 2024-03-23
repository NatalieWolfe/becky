import { Gauge } from 'prom-client';

import { Database } from './database.mjs';
import { Monitor } from './monitor.mjs';
import { OpenWeather } from './openweather.mjs';
import { WeatherLoader } from './weather_loader.mjs';

const BACKFILL_LIMIT = 500;

const monitor = new Monitor({ labels: { app: 'scraper' } });
const db = await Database.open();
const loader = new WeatherLoader(db, new OpenWeather());

const scrapeTime = new Gauge({
  name: 'scrape_duration_seconds',
  help: 'Duration of weather scraping.',
});
const endTimer = scrapeTime.startTimer();
try {
  await Promise.all([
    loader.fetchAllHistory(),
    loader.backfillHistory(BACKFILL_LIMIT)
  ]);
} catch (err) {
  console.error('Failed to fetch history:', err);
} finally {
  endTimer();
}

await monitor.close();
await db.close();
