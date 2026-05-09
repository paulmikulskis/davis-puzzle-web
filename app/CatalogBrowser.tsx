"use client";

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { DifficultyBadge } from "@/app/DifficultyBadge";
import {
  type CatalogCategory,
  type CatalogFile,
  type CatalogItem,
  CATEGORY_LABELS,
  isCatalogFile,
} from "@/lib/catalog";
import { type DifficultyBucket } from "@/lib/difficulty";

export interface CatalogBrowserHandle {
  openAndFocus: (initialQuery?: string) => void;
}

interface CatalogBrowserProps {
  onPick: (canonicalName: string, displayName: string) => void;
}

const DIFFICULTY_OPTIONS: DifficultyBucket[] = ["easy", "medium", "hard"];
const DIFFICULTY_LABEL: Record<DifficultyBucket, string> = {
  easy: "Easy",
  medium: "Medium",
  hard: "Hard",
};

type LoadState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; data: CatalogFile }
  | { status: "error"; message: string };

const STORAGE_KEY = "davis.catalog.open";

export const CatalogBrowser = forwardRef<
  CatalogBrowserHandle,
  CatalogBrowserProps
>(function CatalogBrowser({ onPick }, ref) {
  const [open, setOpen] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  });
  const [state, setState] = useState<LoadState>({ status: "idle" });
  const [search, setSearch] = useState("");
  const [activeCategories, setActiveCategories] = useState<Set<CatalogCategory>>(
    () => new Set(),
  );
  const [activeDifficulties, setActiveDifficulties] = useState<
    Set<DifficultyBucket>
  >(() => new Set());
  const fetchStarted = useRef(false);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const sectionRef = useRef<HTMLElement | null>(null);

  useImperativeHandle(
    ref,
    () => ({
      openAndFocus: (initialQuery?: string) => {
        setOpen(true);
        if (typeof initialQuery === "string") {
          setSearch(initialQuery);
        }
        if (typeof window !== "undefined") {
          window.requestAnimationFrame(() => {
            sectionRef.current?.scrollIntoView({
              behavior: "smooth",
              block: "start",
            });
            window.setTimeout(() => {
              searchInputRef.current?.focus();
              searchInputRef.current?.select();
            }, 60);
          });
        }
      },
    }),
    [],
  );

  useEffect(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEY, open ? "1" : "0");
    }
  }, [open]);

  useEffect(() => {
    if (!open || fetchStarted.current) return;
    fetchStarted.current = true;
    fetch("/items.json", { cache: "default" })
      .then(async (response) => {
        if (!response.ok) throw new Error(`status ${response.status}`);
        const json: unknown = await response.json();
        if (!isCatalogFile(json)) throw new Error("invalid catalog shape");
        return json;
      })
      .then((data) => {
        setState({ status: "ready", data });
      })
      .catch(() => {
        setState({ status: "error", message: "Couldn't load the item catalog." });
      });
  }, [open]);

  const allCategories = useMemo<CatalogCategory[]>(
    () =>
      state.status === "ready"
        ? Array.from(
            new Set(state.data.items.flatMap((item) => item.categories)),
          ).sort()
        : [],
    [state],
  );

  const filteredItems = useMemo<CatalogItem[]>(() => {
    if (state.status !== "ready") return [];
    const query = search.trim().toLowerCase();
    return state.data.items.filter((item) => {
      if (activeCategories.size > 0) {
        const has = item.categories.some((category) =>
          activeCategories.has(category),
        );
        if (!has) return false;
      }
      if (activeDifficulties.size > 0) {
        const itemDifficulty = item.flags?.difficulty as
          | DifficultyBucket
          | undefined;
        if (!itemDifficulty || !activeDifficulties.has(itemDifficulty)) {
          return false;
        }
      }
      if (query.length > 0) {
        const haystack = `${item.displayName} ${item.canonicalName}`.toLowerCase();
        if (!haystack.includes(query)) return false;
      }
      return true;
    });
  }, [state, search, activeCategories, activeDifficulties]);

  function toggleCategory(category: CatalogCategory) {
    setActiveCategories((current) => {
      const next = new Set(current);
      if (next.has(category)) next.delete(category);
      else next.add(category);
      return next;
    });
  }

  function toggleDifficulty(bucket: DifficultyBucket) {
    setActiveDifficulties((current) => {
      const next = new Set(current);
      if (next.has(bucket)) next.delete(bucket);
      else next.add(bucket);
      return next;
    });
  }

  function clearAll() {
    setActiveCategories(new Set());
    setActiveDifficulties(new Set());
  }

  const totalActive = activeCategories.size + activeDifficulties.size;

  return (
    <section
      ref={sectionRef}
      className="rounded-lg border border-[var(--border)] bg-white shadow-sm"
    >
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-controls="catalog-panel"
        className="group flex w-full cursor-pointer items-center justify-between gap-3 rounded-lg px-5 py-4 text-left transition hover:bg-[var(--panel)]"
      >
        <div className="min-w-0">
          <p className="text-sm font-semibold uppercase tracking-[0.08em] text-[var(--accent)]">
            Browse items
          </p>
          <p className="mt-1 text-sm text-[var(--muted)]">
            {state.status === "ready"
              ? `${state.data.items.length} curated Minecraft items, grouped by category.`
              : "Pick from a curated catalog instead of typing."}
          </p>
        </div>
        <span className="shrink-0 rounded-md border border-[var(--border)] bg-white px-3 py-2 text-sm font-medium text-[var(--heading)] transition group-hover:border-[var(--accent)] group-hover:bg-[var(--panel)]">
          {open ? "Hide" : "Open"}
        </span>
      </button>

      {open ? (
        <div
          id="catalog-panel"
          className="border-t border-[var(--border)] px-5 py-5"
        >
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <input
                ref={searchInputRef}
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search items..."
                aria-label="Search catalog"
                className="w-full rounded-md border border-[var(--border)] bg-white px-3 py-2 text-base outline-none transition hover:border-[var(--heading)] focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent-soft)] sm:max-w-sm"
              />
              {totalActive > 0 ? (
                <button
                  type="button"
                  onClick={clearAll}
                  className="cursor-pointer self-start rounded-md border border-[var(--border)] bg-white px-3 py-2 text-sm font-medium text-[var(--heading)] transition hover:border-[var(--accent)] hover:bg-[var(--panel)]"
                >
                  Clear filters ({totalActive})
                </button>
              ) : null}
            </div>

            <div className="davis-filter-row -mx-1 flex items-center gap-2 overflow-x-auto px-1 pb-1 sm:flex-wrap sm:overflow-visible sm:pb-0">
              <span className="shrink-0 text-xs font-semibold uppercase tracking-[0.08em] text-[var(--muted)]">
                Difficulty
              </span>
              {DIFFICULTY_OPTIONS.map((bucket) => {
                const active = activeDifficulties.has(bucket);
                return (
                  <button
                    key={bucket}
                    type="button"
                    onClick={() => toggleDifficulty(bucket)}
                    aria-pressed={active}
                    className={`shrink-0 cursor-pointer rounded-full border px-4 py-2 text-sm font-medium transition ${
                      active
                        ? "border-[var(--accent)] bg-[var(--accent)] text-white"
                        : "border-[var(--border)] bg-white text-[var(--foreground)] hover:border-[var(--accent)] hover:bg-[var(--panel)]"
                    }`}
                  >
                    {DIFFICULTY_LABEL[bucket]}
                  </button>
                );
              })}
            </div>

            {allCategories.length > 0 ? (
              <div className="davis-filter-row -mx-1 flex items-center gap-2 overflow-x-auto px-1 pb-1 sm:flex-wrap sm:overflow-visible sm:pb-0">
                <span className="shrink-0 text-xs font-semibold uppercase tracking-[0.08em] text-[var(--muted)]">
                  Category
                </span>
                {allCategories.map((category) => {
                  const active = activeCategories.has(category);
                  return (
                    <button
                      key={category}
                      type="button"
                      onClick={() => toggleCategory(category)}
                      aria-pressed={active}
                      className={`shrink-0 cursor-pointer rounded-full border px-4 py-2 text-sm font-medium transition ${
                        active
                          ? "border-[var(--accent)] bg-[var(--accent)] text-white"
                          : "border-[var(--border)] bg-white text-[var(--foreground)] hover:border-[var(--accent)] hover:bg-[var(--panel)]"
                      }`}
                    >
                      {CATEGORY_LABELS[category] ?? category}
                    </button>
                  );
                })}
              </div>
            ) : null}

            <CatalogBody
              state={state}
              filteredItems={filteredItems}
              onPick={(canonical, display) => {
                onPick(canonical, display);
                setOpen(false);
              }}
            />

            {state.status === "ready" ? (
              <div className="flex justify-center pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    if (typeof window !== "undefined") {
                      window.requestAnimationFrame(() => {
                        sectionRef.current?.scrollIntoView({
                          behavior: "smooth",
                          block: "start",
                        });
                      });
                    }
                  }}
                  className="cursor-pointer rounded-md border border-[var(--border)] bg-white px-4 py-2.5 text-sm font-medium text-[var(--heading)] transition hover:border-[var(--accent)] hover:bg-[var(--panel)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-soft)]"
                >
                  Hide catalog
                </button>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  );
});

function CatalogBody({
  state,
  filteredItems,
  onPick,
}: {
  state: LoadState;
  filteredItems: CatalogItem[];
  onPick: (canonicalName: string, displayName: string) => void;
}) {
  if (state.status === "idle" || state.status === "loading") {
    return (
      <div className="grid min-h-[200px] place-items-center rounded-md border border-dashed border-[var(--border)] bg-[var(--panel)] p-6 text-sm text-[var(--muted)]">
        Loading items...
      </div>
    );
  }
  if (state.status === "error") {
    return (
      <div className="grid min-h-[200px] place-items-center rounded-md border border-dashed border-[var(--border)] bg-[var(--panel)] p-6 text-sm text-[var(--error)]">
        {state.message}
      </div>
    );
  }
  if (filteredItems.length === 0) {
    return (
      <div className="grid min-h-[200px] place-items-center rounded-md border border-dashed border-[var(--border)] bg-[var(--panel)] p-6 text-sm text-[var(--muted)]">
        No items match these filters.
      </div>
    );
  }
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
      {filteredItems.map((item) => (
        <CatalogTile key={item.canonicalName} item={item} onPick={onPick} />
      ))}
    </div>
  );
}

function CatalogTile({
  item,
  onPick,
}: {
  item: CatalogItem;
  onPick: (canonicalName: string, displayName: string) => void;
}) {
  const difficulty = item.flags?.difficulty as DifficultyBucket | undefined;
  const explanation =
    typeof item.flags?.difficultyExplanation === "string"
      ? item.flags.difficultyExplanation
      : undefined;
  return (
    <button
      type="button"
      onClick={() => onPick(item.canonicalName, item.displayName)}
      className="group flex flex-col items-center gap-2 rounded-md border border-[var(--border)] bg-white p-3 text-center transition hover:border-[var(--accent)] hover:shadow-md focus:outline-none focus-visible:border-[var(--accent)] focus-visible:ring-2 focus-visible:ring-[var(--accent-soft)]"
    >
      <div className="flex aspect-square w-full items-center justify-center rounded-md bg-[var(--panel)] p-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={item.thumbnailPath}
          alt={`${item.displayName} icon`}
          loading="lazy"
          className="h-full w-full object-contain [image-rendering:pixelated]"
        />
      </div>
      <span className="text-xs font-medium leading-tight text-[var(--heading)]">
        {item.displayName}
      </span>
      {difficulty ? (
        <DifficultyBadge bucket={difficulty} explanation={explanation} size="sm" />
      ) : null}
    </button>
  );
}
