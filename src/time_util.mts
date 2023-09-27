import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime.js';
import utc from 'dayjs/plugin/utc.js';

dayjs.extend(relativeTime);
dayjs.extend(utc);

export enum Milliseconds {
  HOUR = 3600
}

/** Returns the unix timestamp for the beginning of the current hour. */
export function hourStart(): number {
  return dayjs().minute(0).second(0).unix();
}
