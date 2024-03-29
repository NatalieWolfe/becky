import { Telegraf } from 'telegraf';
import { message } from 'telegraf/filters';

import { getSecret } from '../secret.mjs';
import { BeckyBotClient } from '../beckybot.mjs';
import { io } from 'socket.io-client';

const BECKY_HOST = process.env.BECKY_HOST || 'becky.becky';
const BECKY_PORT = Number(process.env.BECKY_PORT) || 6001

const bot = new Telegraf(await getSecret('telegram_api_key'));
const becky = new BeckyBotClient(io(`http://${BECKY_HOST}:${BECKY_PORT}`));

bot.start((ctx) => ctx.reply('Where\'re we climbin?'));
bot.on(message('text'), async (ctx) => {
  for await (const location of becky.whereToGo(ctx.message.text)) {
    ctx.sendMessage(location.name);
  }
});
// TODO - Add more command replies here.

await bot.launch();

async function shutdown() {
  bot.stop('Shutting down.');
}

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
