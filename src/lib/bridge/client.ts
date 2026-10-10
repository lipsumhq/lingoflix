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

export interface BridgeClient {
  call<M extends BridgeMethod>(method: M, ...args: Parameters<BridgeMethods[M]>): Promise<ReturnType<BridgeMethods[M]>>;
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

  const onResponse = (event: Event) => {
    const res = decode<BridgeResponse>((event as CustomEvent).detail);
    if (!res) return;
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
      const id = `${prefix}-${++seq}`;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new BridgeError('timeout', `Bridge call ${method} timed out`));
        }, timeoutMs);
        pending.set(id, { resolve: resolve as (value: unknown) => void, reject, timer });
        target.dispatchEvent(new CustomEvent(BRIDGE_REQUEST_EVENT, { detail: encode({ id, method, args }) }));
      });
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
