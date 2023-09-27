import { io } from 'socket.io-client';

import { BeckyBot } from './beckybot.mjs';
import { Database } from './database.mjs';
import { getSecret } from './secret.mjs';
import { OpenWeather } from './openweather.mjs';
import { WeatherLoader } from './weather_loader.mjs';

const TELEGRAM_BOT_HOST = await getSecret('telegram_bot_host');

const db = await Database.open('becky.sqlite');
const socket = io(`http://${TELEGRAM_BOT_HOST}/becky`);
const weather = new OpenWeather();
const loader = new WeatherLoader(db, weather);
const beckyBot = new BeckyBot(db, socket, loader, weather);
await beckyBot.wait();
await db.close();
