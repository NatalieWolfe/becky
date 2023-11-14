import { io } from 'socket.io-client';

import { BeckyBot } from './beckybot.mjs';
import { Database } from './database.mjs';
import { Monitor } from './monitor.mjs';
import { OpenWeather } from './openweather.mjs';
import { getSecret } from './secret.mjs';
import { WeatherLoader } from './weather_loader.mjs';

const TELEGRAM_BOT_HOST = await getSecret('telegram_bot_host');

const monitor = new Monitor({ labels: { app: 'becky' } });
const db = await Database.open();
const socket = io(`http://${TELEGRAM_BOT_HOST}/becky`);
const weather = new OpenWeather();
const loader = new WeatherLoader(db, weather);
const beckyBot = new BeckyBot(db, socket, loader, weather);
await beckyBot.wait();
await db.close();
await monitor.close();
