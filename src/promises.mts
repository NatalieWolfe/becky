export class InvertedPromise<T> {
  readonly promise = new Promise<T>((resolve, reject) => {
    this._resolve = resolve;
    this._reject = reject;
  });
  get resolve() { return this._resolve; }
  get reject() { return this._reject; }

  private _resolve: (result: T) => void;
  private _reject: (error: unknown) => void;
}
