/** A toast counts down only while all reasons for pausing are cleared. */
export function createToastTimer(duration: number, dismiss: () => void) {
  let remaining = duration;
  let started = Date.now();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let finished = false;
  const reasons = new Set<string>();
  function schedule() {
    started = Date.now();
    timeout = setTimeout(() => {
      finished = true;
      dismiss();
    }, remaining);
  }
  schedule();
  return {
    pause(reason: string) {
      if (finished || reasons.has(reason)) return;
      if (!reasons.size) {
        clearTimeout(timeout);
        remaining = Math.max(0, remaining - (Date.now() - started));
      }
      reasons.add(reason);
    },
    resume(reason: string) {
      if (finished || !reasons.delete(reason) || reasons.size) return;
      schedule();
    },
    dispose() {
      finished = true;
      clearTimeout(timeout);
    },
  };
}
