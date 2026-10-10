import {
  BRIDGE_REQUEST_EVENT,
  BRIDGE_RESPONSE_EVENT,
  BridgeError,
  decode,
  encode,
  type BridgeMethods,
  type BridgeRequest,
  type BridgeResponse,
} from './protocol';

export function serveBridge(target: EventTarget, methods: BridgeMethods): () => void {
  const onRequest = (event: Event) => {
    const req = decode<BridgeRequest>((event as CustomEvent).detail);
    if (!req || typeof req.id !== 'string') return;

    let res: BridgeResponse;
    const fn = Object.hasOwn(methods, req.method) ? (methods as unknown as Record<string, unknown>)[req.method] : undefined;
    if (typeof fn !== 'function' || !Array.isArray(req.args)) {
      res = { id: req.id, ok: false, code: 'bad-request', message: `Unknown method ${String(req.method)}` };
    } else {
      try {
        res = { id: req.id, ok: true, result: (fn as (...args: unknown[]) => unknown).apply(methods, req.args) ?? null };
      } catch (err) {
        res =
          err instanceof BridgeError
            ? { id: req.id, ok: false, code: err.code, message: err.message }
            : { id: req.id, ok: false, code: 'internal', message: String(err) };
      }
    }
    target.dispatchEvent(new CustomEvent(BRIDGE_RESPONSE_EVENT, { detail: encode(res) }));
  };

  target.addEventListener(BRIDGE_REQUEST_EVENT, onRequest);
  return () => target.removeEventListener(BRIDGE_REQUEST_EVENT, onRequest);
}
