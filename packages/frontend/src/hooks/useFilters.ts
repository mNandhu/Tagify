import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { parseFilters, serializeFilters, type Filters } from "../lib/imageFilter";

/**
 * Bind the Image filter to the URL with the URL as the single source of truth:
 * `filters` is derived from the search params, and `setFilters` writes them
 * back. No mirrored state and no sync effects, so the URL and the filter can
 * never drift. See CONTEXT.md › Frontend › Image filter.
 */
export function useFilters(): [Filters, (next: Filters) => void] {
  const [searchParams, setSearchParams] = useSearchParams();
  const filters = useMemo(() => parseFilters(searchParams), [searchParams]);
  const setFilters = useCallback(
    (next: Filters) => setSearchParams(serializeFilters(next), { replace: true }),
    [setSearchParams],
  );
  return [filters, setFilters];
}
