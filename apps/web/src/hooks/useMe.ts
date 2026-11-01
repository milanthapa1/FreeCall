"use client";

import { useEffect, useState } from "react";
import type { MeResponse } from "../../app/api/me/route";

type MeState =
  | { status: "loading" }
  | { status: "authenticated"; user: MeResponse }
  | { status: "unauthenticated" };

export function useMe(): MeState {
  const [state, setState] = useState<MeState>({ status: "loading" });

  useEffect(() => {
    fetch("/api/me", { credentials: "include", cache: "no-store" })
      .then((r) => {
        if (r.status === 401) {
          setState({ status: "unauthenticated" });
          return null;
        }
        return r.json() as Promise<MeResponse>;
      })
      .then((data) => {
        if (data) setState({ status: "authenticated", user: data });
      })
      .catch(() => setState({ status: "unauthenticated" }));
  }, []);

  return state;
}
