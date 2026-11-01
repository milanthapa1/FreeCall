"use client";

import { useEffect, useState } from "react";

/** Polls /api/stats every 15 seconds and returns the live online count. */
export function useOnlineCount(): number | null {
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;

    const fetch_ = () => {
      fetch("/api/stats", { cache: "no-store" })
        .then((r) => r.json())
        .then((data: { onlineCount: number | null }) => {
          if (!cancelled) setCount(data.onlineCount);
        })
        .catch(() => {
          // silently ignore — realtime server may not be running in dev
        });
    };

    fetch_();
    const interval = setInterval(fetch_, 15_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  return count;
}
