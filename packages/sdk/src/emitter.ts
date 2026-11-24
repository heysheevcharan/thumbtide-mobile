type Handler = (...args: any[]) => void;

/** Minimal typed event emitter. `on` returns an unsubscribe function. */
export class Emitter<Events extends Record<string, Handler>> {
  private handlers = new Map<keyof Events, Set<Handler>>();

  on<K extends keyof Events>(event: K, fn: Events[K]): () => void {
    let set = this.handlers.get(event);
    if (!set) this.handlers.set(event, (set = new Set()));
    set.add(fn);
    return () => set!.delete(fn);
  }

  once<K extends keyof Events>(event: K, fn: Events[K]): () => void {
    const off = this.on(event, ((...args: any[]) => {
      off();
      fn(...args);
    }) as Events[K]);
    return off;
  }

  protected emit<K extends keyof Events>(event: K, ...args: Parameters<Events[K]>) {
    const set = this.handlers.get(event);
    if (!set) return;
    for (const fn of [...set]) {
      try {
        fn(...args);
      } catch (err) {
        console.error(`[thumbtide] error in "${String(event)}" handler`, err);
      }
    }
  }
}
