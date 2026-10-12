// Observable state: get(), set() and subscribe(), the same one way data flow as Redux
export type Listener<S> = (state: Readonly<S>, previous: Readonly<S>) => void;

export class Store<S extends object> {
  private state: S;
  private readonly listeners = new Set<Listener<S>>();

  constructor(initial: S) {
    this.state = initial;
  }

  get(): Readonly<S> {
    return this.state;
  }

  set(patch: Partial<S> | ((s: Readonly<S>) => Partial<S>)): void {
    const previous = this.state;
    const changes = typeof patch === 'function' ? patch(previous) : patch;
    this.state = { ...previous, ...changes };
    this.listeners.forEach((fn) => fn(this.state, previous));
  }

  subscribe(fn: Listener<S>): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}
