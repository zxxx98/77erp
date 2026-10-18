import { useState, useRef } from 'react';
import { api } from './api.js';
export function useBusiness() {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const lock = useRef(false),
    key = useRef({});
  const run = async (fn) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(e.message);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  const send = async (path, body) => {
    const fingerprint = JSON.stringify([path, body]);
    if (key.current.fingerprint !== fingerprint)
      key.current = {
        fingerprint,
        id: Array.from(crypto.getRandomValues(new Uint32Array(4)), (x) =>
          x.toString(16),
        ).join("-"),
      };
    const id = key.current.id;
    const result = await api(path, {
      method: "POST",
      body: { ...body, request_id: id },
    });
    if (key.current.id === id) key.current = {};
    return result;
  };
  return { busy, error, setError, run, send };
}
