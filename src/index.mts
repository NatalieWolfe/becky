import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime.js';
import utc from 'dayjs/plugin/utc.js';
import { io } from 'socket.io-client';

import { BeckyBot } from './beckybot.mjs';
import { Database } from './database.mjs';
import { getForecast, getHistorical } from './openweather.mjs';
import { getSecret } from './secret.mjs';

const HOUR = 3600;
const MAX_FETCH_WINDOW = 48 * HOUR;  // 48 hours in seconds.
const FETCH_DELAY_HOURS = 24;
const TELEGRAM_BOT_HOST = await getSecret('telegram_bot_host');

dayjs.extend(relativeTime);
dayjs.extend(utc);
const db = await Database.open('becky.sqlite');
let fetchTimeout = scheduleHistoryFetching();

const socket = io(`http://${TELEGRAM_BOT_HOST}/becky`);
const beckyBot = new BeckyBot(db, socket);
await beckyBot.wait();
await db.close();
clearTimeout(fetchTimeout);

function scheduleHistoryFetching(): NodeJS.Timeout {
  const time = dayjs()
    .utc()
    .add(FETCH_DELAY_HOURS, 'hours')
    .hour(randInt(0, 2)).minute(randInt(0, 60)).second(0);
  console.log(`Next history fetch ${time.fromNow()} at ${time.format()}`);
  return setTimeout(async () => {
    try {
      await fetchHistory();
    } catch (err) {
      console.error('Failed to fetch history:', err);
    }
    fetchTimeout = scheduleHistoryFetching();
  }, time.valueOf() - Date.now());
}

async function fetchHistory() {
  const endTime = dayjs().minute(0).second(0).millisecond(0).unix();
  const oldestTime = endTime - MAX_FETCH_WINDOW;
  for await (const location of db.listLocations()) {
    console.log(location);
    const lastTime = (location.lastWeatherTime ?? -Infinity);
    for (
      let time = Math.max(oldestTime, lastTime + HOUR);
      time < endTime;
      time += HOUR
    ) {
      const weather = await getHistorical(location.lat, location.lon, time);
      await db.insertWeatherHistory(location.id, time, weather.data[0]);
    }
  }
}

function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min)) + min;
}
