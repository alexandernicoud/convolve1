import { useEffect, useState } from "react";
import { fetchApi } from "@/lib/api";

type Props = React.ImgHTMLAttributes<HTMLImageElement> & { src: string };

function isApiAsset(src: string) {
  return /\/api\/|\/runs\/|\/trainer\//.test(src);
}

/** Load images that sit behind JWT auth (img src cannot send Authorization). */
export function AuthorizedImage({ src, alt, ...rest }: Props) {
  const [blobSrc, setBlobSrc] = useState<string | null>(null);

  useEffect(() => {
    if (!isApiAsset(src)) {
      setBlobSrc(src);
      return;
    }
    let objectUrl: string | null = null;
    let cancelled = false;
    const path = src.startsWith("http") ? new URL(src).pathname + new URL(src).search : src;
    void (async () => {
      try {
        const res = await fetchApi(path);
        if (!res.ok) throw new Error(String(res.status));
        const blob = await res.blob();
        objectUrl = URL.createObjectURL(blob);
        if (!cancelled) setBlobSrc(objectUrl);
      } catch {
        if (!cancelled) setBlobSrc(null);
      }
    })();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [src]);

  if (!blobSrc) return null;
  return <img src={blobSrc} alt={alt ?? ""} {...rest} />;
}
