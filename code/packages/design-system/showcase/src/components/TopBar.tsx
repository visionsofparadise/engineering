interface TopBarProps<Page extends string> {
  readonly pages: ReadonlyArray<Page>;
  readonly activePage: Page;
  readonly onPageChange: (page: Page) => void;
}

export function TopBar<Page extends string>({ pages, activePage, onPageChange }: TopBarProps<Page>) {
  return (
    <nav className="flex h-8 shrink-0 items-center bg-chrome-surface px-2">
      {pages.map((page) => {
        const isActive = page === activePage;

        return (
          <button
            key={page}
            type="button"
            className={`mx-2 py-1 font-technical text-[length:var(--text-sm)] uppercase tracking-[0.06em] transition-colors duration-150 ${
              isActive
                ? "bg-primary text-void"
                : "text-chrome-text-secondary hover:text-chrome-text"
            }`}
            onClick={() => {
              onPageChange(page);
            }}
          >
            {page}
          </button>
        );
      })}
    </nav>
  );
}
