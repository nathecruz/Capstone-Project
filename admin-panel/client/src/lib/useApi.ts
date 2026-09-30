import { useCallback, useEffect, useRef, useState } from 'react';
import { get } from './api';

interface State<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
}

/**
 * Fetches `path` and refetches when it changes. Previous data is kept while a
 * refetch is in flight so views hold their frame instead of flashing.
 */
export function useApi<T>(path: string | null) {
  const [state, setState] = useState<State<T>>({ data: null, error: null, loading: Boolean(path) });
  const [version, setVersion] = useState(0);
  const latest = useRef(0);

  useEffect(() => {
    if (!path) return;
    const controller = new AbortController();
    const request = ++latest.current;
    setState((current) => ({ ...current, loading: true, error: null }));
    get<T>(path, controller.signal)
      .then((data) => {
        if (request === latest.current) setState({ data, error: null, loading: false });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted || request !== latest.current) return;
        setState((current) => ({ ...current, loading: false, error: error instanceof Error ? error.message : 'Request failed.' }));
      });
    return () => controller.abort();
  }, [path, version]);

  const reload = useCallback(() => setVersion((value) => value + 1), []);
  const setData = useCallback((data: T) => setState((current) => ({ ...current, data })), []);
  return { ...state, reload, setData };
}
