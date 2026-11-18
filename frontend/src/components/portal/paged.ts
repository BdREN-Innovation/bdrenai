"use client";
import { useCallback, useEffect, useState } from "react";
import { getJson } from "@/lib/api";
import { Paged } from "@/lib/portal";

/**
 * One page of a portal list. Reloads when `url` or `version` changes or `reload()` is called, and applies only
 * the latest request's answer, so a slow response for an earlier filter or page never replaces the current one.
 */
export function usePaged<T>(url: string, version: number) {
  const [data, setData] = useState<Paged<T> | null>(null);
  const [failed, setFailed] = useState(false);
  const [reloads, setReloads] = useState(0);

  useEffect(() => {
    let current = true;
    getJson<Paged<T>>(url).then((res) => {
      if (!current) return;
      setFailed(!res.ok);
      if (res.ok) setData(res.data);
    });
    return () => {
      current = false;
    };
  }, [url, version, reloads]);

  const reload = useCallback(() => setReloads((n) => n + 1), []);
  return { data, failed, reload };
}
