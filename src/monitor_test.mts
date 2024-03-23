import { Histogram, MetricValueWithName } from 'prom-client';
import { afterEach, describe, expect, test } from 'vitest';

import { time } from './monitor.mjs';

describe('time', () => {
  const metric = new Histogram({ name: 'test_metric', help: 'for testing' });
  afterEach(() => metric.reset());

  async function getTotalCount<T extends string>(
    metric: Histogram<T>
  ): Promise<number> {
    const countMetric = (await metric.get())
      .values.find(({ metricName }) => /_count$/.test(metricName));
    return countMetric?.value ?? 0;
  }

  test('measures synchronous execution', async () => {
    time(metric, () => { });
    expect(await getTotalCount(metric)).toEqual(1);
    time(metric, () => { });
    expect(await getTotalCount(metric)).toEqual(2);
  });

  test('measures synchronous failures', async () => {
    expect(() => time(metric, () => { throw new Error('oops'); }))
      .toThrowError('oops');
    expect(await getTotalCount(metric)).toEqual(1);
  });

  test('measures asynchronous execution', async () => {
    let resolve: () => void;
    const prom = time(
      metric,
      () => new Promise<void>((res) => { resolve = res; })
    );
    expect(await getTotalCount(metric)).toEqual(0);
    resolve();
    await prom;
    expect(await getTotalCount(metric)).toEqual(1);
  });

  test('measures asynchronous failures', async () => {
    try {
      await time(
        metric,
        () => new Promise<void>((_, reject) => { reject(new Error('oops')); })
      );
      expect(true, 'should not reach this point').toBeFalsy();
    } catch (err: unknown) {
      expect((err as Error)?.message).toEqual('oops');
    }
  });

  test('records labels', async () => {
    const h = new Histogram({ name: 'label_metric', help: 'for testing', labelNames: ['foo'] });
    time(h, { foo: 'bar' }, () => { });
    time(h, { foo: 'bazz' }, () => { });
    const fooValues = (await h.get()).values.reduce(
      (vals, { labels }): Set<string> => vals.add(String(labels.foo ?? '')),
      new Set<string>()
    );
    expect(fooValues).toEqual(new Set(['bar', 'bazz']));
  });
});
