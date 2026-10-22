import { useEffect, useState } from "react";
import type { ReviewAssetDetail, ReviewAssetKind } from "@/lib/api";
import { reviewApi } from "@/lib/api";

const cache = new Map<string, Promise<ReviewAssetDetail>>();
const MAX = 64;

export function fetchAssetDetail(kind: ReviewAssetKind, id: string): Promise<ReviewAssetDetail> {
  const key = `${kind}:${id}`;
  let p = cache.get(key);
  if (!p) {
    p = reviewApi.getAsset(kind, id);
    p.catch(() => cache.delete(key));
    cache.set(key, p);
    if (cache.size > MAX) cache.delete(cache.keys().next().value as string);
  }
  return p;
}

export function clearAssetDetailCache() {
  cache.clear();
}

/** One compact request per inspected asset; cached for the session. */
export function useAssetDetail(kind: ReviewAssetKind | null, id: string | null) {
  const [state, setState] = useState<{ detail: ReviewAssetDetail | null; loading: boolean; error: string | null }>({
    detail: null,
    loading: false,
    error: null,
  });
  useEffect(() => {
    if (!kind || !id) {
      setState({ detail: null, loading: false, error: null });
      return;
    }
    let live = true;
    setState({ detail: null, loading: true, error: null });
    fetchAssetDetail(kind, id).then(
      (detail) => live && setState({ detail, loading: false, error: null }),
      (e) => live && setState({ detail: null, loading: false, error: e instanceof Error ? e.message : "Could not load details" }),
    );
    return () => {
      live = false;
    };
  }, [kind, id]);
  return state;
}

export function useAssetDetails(refs: { kind: ReviewAssetKind; id: string }[]) {
  const key = refs.map((r) => `${r.kind}:${r.id}`).join(",");
  const [details, setDetails] = useState<(ReviewAssetDetail | null)[]>([]);
  useEffect(() => {
    let live = true;
    setDetails(refs.map(() => null));
    refs.forEach((r, i) =>
      fetchAssetDetail(r.kind, r.id).then(
        (d) => live && setDetails((prev) => prev.map((x, j) => (j === i ? d : x))),
        () => undefined,
      ),
    );
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return details;
}
