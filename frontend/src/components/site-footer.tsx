import Link from "next/link";

import { DSC_REPO_URL } from "@/config/links";

export function SiteFooter() {
  return (
    <footer className="border-t border-line">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-2 px-4 py-6 text-xs text-faint sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <p>
          DSC is a teaching-grade overcollateralized stablecoin. Not audited, not a product.
        </p>
        <div className="flex items-center gap-4">
          <Link href="/activity" className="hover:text-muted">
            Activity
          </Link>
          <a
            href={DSC_REPO_URL}
            target="_blank"
            rel="noreferrer noopener"
            className="hover:text-muted"
          >
            Source
          </a>
        </div>
      </div>
    </footer>
  );
}
