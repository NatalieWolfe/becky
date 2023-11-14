import dayjs from 'dayjs';
import { Counter } from 'prom-client';

import { Database, Location } from './database.mjs';
import { OpenWeather } from './openweather.mjs';
import { Milliseconds, hourStart } from './time_util.mjs';

const MAX_FETCH_WINDOW = 48 * Milliseconds.HOUR;  // 48 hours in seconds.

const weatherFetchCounter = new Counter({
  name: 'weather_fetch_total',
  help: 'Count of new weather data points fetched.'
});
const backfillFetchCounter = new Counter({
  name: 'weather_backfill_fetch_total',
  help: 'Count of historical weather data points fetched.'
});

export class WeatherLoader {
  constructor(
    private readonly _db: Database,
    private readonly _weather: OpenWeather
  ) { }

  async fetchAllHistory() {
    const endTime = hourStart();
    console.log(
      'Fetching until', dayjs.unix(endTime).format('YYYY-MM-DD HH:mm:ss')
    );
    for await (const [location] of this._db.listLocations()) {
      console.log(location.id, location.name, location.lastWeatherTime);
      await this.updateHistory(location, endTime);
    }
  }

  async updateHistory(location: Location, endTime?: number) {
    if (!endTime) endTime = hourStart();
    const beginTime = endTime - MAX_FETCH_WINDOW;
    const lastTime = (location.lastWeatherTime ?? -Infinity);
    for (
      let time = Math.max(beginTime, lastTime + Milliseconds.HOUR);
      time < endTime;
      time += Milliseconds.HOUR
    ) {
      const weather =
        await this._weather.getHistorical(location.lat, location.lon, time);
      await this._db.insertWeatherHistory(location.id, time, weather.data[0]);
      weatherFetchCounter.inc();
    }
  }

  async backfillHistory(limit: number) {
    let selected: Location;
    let youngestDate: number;
    for await (const [location] of this._db.listLocations()) {
      const date = await this._db.getOldestForecast(location.id);
      if (!youngestDate || youngestDate < date) {
        youngestDate = date;
        selected = location;
      }
    }
    if (!selected) return;
    console.log(
      'Backfilling', selected.name, 'from',
      dayjs.unix(youngestDate).format('YYYY-MM-DD')
    );

    let time = youngestDate - Milliseconds.HOUR;
    for (let i = 0; i < limit; ++i, time -= Milliseconds.HOUR) {
      const weather =
        await this._weather.getHistorical(selected.lat, selected.lon, time);
      await this._db.insertWeatherHistory(selected.id, time, weather.data[0]);
      backfillFetchCounter.inc();
    }
  }
}
