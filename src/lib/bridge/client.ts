import {
  BRIDGE_REQUEST_EVENT,
  BRIDGE_RESPONSE_EVENT,
  BridgeError,
  decode,
  encode,
  type BridgeMethod,
  type BridgeMethods,
  type BridgeResponse,
} from './protocol';

export type BridgeResult<T> = { ok: true; result: T } | { ok: false; error: BridgeError };

export interface BridgeClient {
  call<M extends BridgeMethod>(method: M, ...args: Parameters<BridgeMethods[M]>): Promise<ReturnType<BridgeMethods[M]>>;
  /**
   * Same request, answered before this returns: DOM event dispatch runs the page bridge's listener
   * synchronously. Lets a key handler know whether the seek worked before deciding to swallow the key.
   */
  callSync<M extends BridgeMethod>(method: M, ...args: Parameters<BridgeMethods[M]>): BridgeResult<ReturnType<BridgeMethods[M]>>;
  dispose(): void;
}

interface Pending {
  resolve(value: unknown): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
}

export function createBridgeClient(target: EventTarget, timeoutMs = 1000): BridgeClient {
  const prefix = Math.random().toString(36).slice(2);
  let seq = 0;
  const pending = new Map<string, Pending>();
  const syncSlots = new Map<string, BridgeResponse | null>();
  const nextId = () => `${prefix}-${++seq}`;
  const send = (id: string, method: string, args: unknown[]) =>
    target.dispatchEvent(new CustomEvent(BRIDGE_REQUEST_EVENT, { detail: encode({ id, method, args }) }));

  const onResponse = (event: Event) => {
    const res = decode<BridgeResponse>((event as CustomEvent).detail);
    if (!res) return;
    if (syncSlots.has(res.id)) {
      syncSlots.set(res.id, res);
      return;
    }
    const entry = pending.get(res.id);
    if (!entry) return;
    pending.delete(res.id);
    clearTimeout(entry.timer);
    if (res.ok) entry.resolve(res.result);
    else entry.reject(new BridgeError(res.code, res.message));
  };
  target.addEventListener(BRIDGE_RESPONSE_EVENT, onResponse);

  return {
    call(method, ...args) {
      const id = nextId();
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new BridgeError('timeout', `Bridge call ${method} timed out`));
        }, timeoutMs);
        pending.set(id, { resolve: resolve as (value: unknown) => void, reject, timer });
        send(id, method, args);
      });
    },
    callSync(method, ...args) {
      const id = nextId();
      syncSlots.set(id, null);
      send(id, method, args);
      const res = syncSlots.get(id) ?? null;
      syncSlots.delete(id);
      if (!res) return { ok: false, error: new BridgeError('timeout', `Bridge did not answer ${method}`) };
      if (!res.ok) return { ok: false, error: new BridgeError(res.code, res.message) };
      return { ok: true, result: res.result as ReturnType<BridgeMethods[typeof method]> };
    },
    dispose() {
      target.removeEventListener(BRIDGE_RESPONSE_EVENT, onResponse);
      for (const entry of pending.values()) {
        clearTimeout(entry.timer);
        entry.reject(new BridgeError('internal', 'Bridge client disposed'));
      }
      pending.clear();
    },
  };
}
