"use client";
import { useCallback, useEffect, useState } from "react";
import { api, type Me } from "@/lib/api";

export function useMe() {
  const [me, setMe] = useState<Me | null>(null);
  const reload = useCallback(() => {
    api<Me>("/api/me").then(setMe, () => setMe({ user: null, resources: { country: "United States", emergency: "911", crisis: [] } }));
  }, []);
  useEffect(reload, [reload]);
  return { me, reload };
}
