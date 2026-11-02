"use client";

import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

/**
 * True after hydration: use it to avoid SSR/client mismatches for wallet state.
 * Implemented with useSyncExternalStore so no effect or extra render is needed.
 */
export function useMounted(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}
