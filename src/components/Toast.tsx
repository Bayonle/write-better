import { useEffect, useRef } from "react";
import { createToastTimer } from "../toast-timer";

export interface ToastMessage {
  text: string;
  action?: () => void;
}
export function Toast({
  message,
  paused,
  onDismiss,
}: {
  message: ToastMessage;
  paused: boolean;
  onDismiss: () => void;
}) {
  const timer = useRef<ReturnType<typeof createToastTimer> | null>(null);
  const dismiss = useRef(onDismiss);
  dismiss.current = onDismiss;
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const countdown = createToastTimer(message.action ? 9000 : 5000, () =>
      dismiss.current(),
    );
    timer.current = countdown;
    if (paused) countdown.pause("dialog");
    if (root.current?.contains(document.activeElement))
      countdown.pause("focus");
    if (
      matchMedia("(hover: hover) and (pointer: fine)").matches &&
      root.current?.matches(":hover")
    )
      countdown.pause("hover");
    const visibility = () =>
      document.hidden ? countdown.pause("hidden") : countdown.resume("hidden");
    visibility();
    document.addEventListener("visibilitychange", visibility);
    return () => {
      countdown.dispose();
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [message]);
  useEffect(() => {
    if (paused) timer.current?.pause("dialog");
    else timer.current?.resume("dialog");
  }, [paused]);
  return (
    <div
      ref={root}
      className="toast"
      onPointerEnter={(e) => {
        if (e.pointerType !== "touch") timer.current?.pause("hover");
      }}
      onPointerLeave={() => timer.current?.resume("hover")}
      onFocusCapture={() => timer.current?.pause("focus")}
      onBlurCapture={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null))
          timer.current?.resume("focus");
      }}
    >
      <span role="status">{message.text}</span>
      {message.action && (
        <button
          onClick={() => {
            message.action?.();
            onDismiss();
          }}
        >
          Undo
        </button>
      )}
      <button
        className="toast-dismiss"
        aria-label="Dismiss notification"
        onClick={onDismiss}
      >
        ×
      </button>
    </div>
  );
}
