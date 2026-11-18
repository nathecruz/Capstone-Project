// Whether the phone or browser asks for less motion (Reduce Motion, prefers-reduced-motion): moving
// pictures such as Habi's 3D animations then stay still. One shared listener for every caller.
import { useSyncExternalStore } from 'react';
import { AccessibilityInfo } from 'react-native';

let reduced = false;
let listening = false;
const listeners = new Set<() => void>();

function update(value: boolean) {
  if (value === reduced) return;
  reduced = value;
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  if (!listening) {
    listening = true;
    void AccessibilityInfo.isReduceMotionEnabled?.().then(update, () => undefined);
    AccessibilityInfo.addEventListener?.('reduceMotionChanged', update);
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useReduceMotion() {
  return useSyncExternalStore(subscribe, () => reduced, () => reduced);
}
