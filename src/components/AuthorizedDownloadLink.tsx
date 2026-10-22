import type { ReactNode } from "react";
import { downloadApiFile } from "@/lib/api";

type Props = {
  path: string;
  filename: string;
  className?: string;
  title?: string;
  children: ReactNode;
};

/** Download a protected API file with the Bearer token (plain `<a href>` cannot). */
export function AuthorizedDownloadLink({ path, filename, className, title, children }: Props) {
  return (
    <button
      type="button"
      title={title}
      className={className}
      onClick={() => void downloadApiFile(path, filename)}
    >
      {children}
    </button>
  );
}
