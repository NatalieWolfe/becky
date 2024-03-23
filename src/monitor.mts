import EventEmitter from 'node:events';
import { Server, ServerResponse, createServer } from 'node:http';
import { Gauge, Histogram, collectDefaultMetrics, register } from 'prom-client';

import { logger } from './logging.mjs';

const DEFAULT_PORT = Number(process.env.METRICS_PORT) || 4001;
const DEFAULT_HOSTNAME = '0.0.0.0';

interface MonitorOptions {
  port?: number;
  hostname?: string;
  labels?: { [key: string]: string };
}

export class Monitor {
  private readonly _server: Server;
  private readonly _listeningProm: Promise<void>;
  private readonly _emitter = new EventEmitter();
  private _closeProm?: Promise<void>;

  constructor({ port, hostname, labels }: MonitorOptions = {}) {
    port = port ?? DEFAULT_PORT;
    hostname = hostname ?? DEFAULT_HOSTNAME;
    this._server = this._startServer();
    this._listeningProm = (new Promise<void>((resolve) => {
      this._server.listen(port, hostname, resolve);
    })).then(() => {
      logger.info('Metrics server listening.', { port, hostname });
    }, (error) => {
      logger.error(
        'Failed to start metrics server.',
        { port, hostname, error }
      );
      throw error;
    });
    collectDefaultMetrics({ labels });
  }

  /**
   * Closes the metrics scraping server.
   *
   * By default waits for 1 more scrape cycle before shutting down to ensure
   * everything is gathered.
   *
   * @param force
   * Set to `true` to shut down immediately. Default is `false`.
   */
  async close(force: boolean = false) {
    if (force) return await this._closeNow();
    if (!this._closeProm) {
      this._closeProm = new Promise<void>((resolve) => {
        this._emitter.once('metricsSent', async () => {
          await this._closeNow();
          resolve();
        });
      });
    }
    await this._closeProm;
  }

  private _startServer(): Server {
    return createServer(async (req, res) => {
      try {
        if (req.url === '/metrics') {
          logger.info('Retrieving metrics.');
          res.setHeader('Content-Type', register.contentType);
          await end(res, await register.metrics());
          this._emitter.emit('metricsSent');
          return;
        }
        logger.warn('Unknown request to metrics service.', { url: req.url });
        res.statusCode = 404;
        res.end('Not found');
      } catch (err) {
        res.statusCode = 500;
        await end(res, `${err}`);
      }
    });
  }

  private async _closeNow() {
    await this._listeningProm;
    await new Promise<void>((resolve, reject) => {
      this._server.close((err) => err ? reject(err) : resolve());
    });
  }
}

/**
 * Calls the given function and records its execution time in the provided
 * metric.
 *
 * Duration is recorded in floating seconds.
 *
 * @param metric
 * The histogram metric to use for recording the times.
 *
 * @param labels
 * Optional labels as required for the metric.
 *
 * @param func
 * The function whose duration is to be recorded.
 */
export function time<T>(metric: Histogram, func: () => T): T;
export function time<T, Labels extends string>(
  metric: Histogram<Labels>,
  labels: Record<Labels, string | number>,
  func: () => T
): T;
export function time<T>(metric: Gauge, func: () => T): T;
export function time<T, Labels extends string>(
  metric: Gauge<Labels>,
  labels: Record<Labels, string | number>,
  func: () => T
): T;
export function time<T>(
  metric: Histogram | Gauge,
  labels?: Record<string, string | number> | (() => T),
  func?: () => T
): T {
  if (typeof labels === 'function') {
    func = labels as () => T;
    labels = null;
  }
  if (metric instanceof Histogram) {
    return timeHistogram(
      metric,
      labels as Record<string, string | number> | null,
      func
    );
  } else {
    return timeGauge(
      metric,
      labels as Record<string, string | number> | null,
      func
    );
  }
}

function timeHistogram<T, Labels extends string>(
  metric: Histogram<Labels>,
  labels: Record<Labels, string | number> | null,
  func: () => T
): T {
  const start = Date.now();
  let record = labels ? () => {
    metric.observe(
      labels as Partial<Record<string, string | number>>,
      (Date.now() - start) / 1000
    );
  } : () => {
    metric.observe((Date.now() - start) / 1000);
  }

  try {
    let res = func();
    if (res instanceof Promise) {
      res = res.finally(record) as T;
      record = null;
    }
    return res;
  } finally {
    if (record) record();
  }
}

function timeGauge<T, Labels extends string>(
  metric: Gauge<Labels>,
  labels: Record<Labels, string | number> | null,
  func: () => T
): T {
  let endTimer = metric.startTimer(labels);
  try {
    let res = func();
    if (res instanceof Promise) {
      res = res.finally(endTimer) as T;
      endTimer = null;
    }
    return res;
  } finally {
    if (endTimer) endTimer();
  }
}

function end(
  stream: ServerResponse,
  ...args: [string?, BufferEncoding?]
): Promise<void> {
  return new Promise<void>((resolve) => {
    stream.end(...args, resolve);
  });
}
