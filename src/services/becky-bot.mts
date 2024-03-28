import io from 'socket.io';

import { BeckyBot } from '../beckybot.mjs';
import { Database } from '../database.mjs';
import { Monitor } from '../monitor.mjs';
import { OpenWeather } from '../openweather.mjs';
import { WeatherLoader } from '../weather_loader.mjs';

const SOCKET_SERVER_PORT = Number(process.env.SOCKET_SERVER_PORT) || 6001;

const monitor = new Monitor({ labels: { app: 'becky' } });
const db = await Database.open();
const server = new io.Server(SOCKET_SERVER_PORT, { path: '/becky' });
const weather = new OpenWeather();
const loader = new WeatherLoader(db, weather);
const beckyBot = new BeckyBot(db, server, loader, weather);

await beckyBot.wait();

await db.close();
await monitor.close();
