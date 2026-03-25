import { Icon } from "@iconify/react";
import { useColormapTheme } from "./ThemeContext";

interface TopBarProps<Page extends string> {
  readonly pages: ReadonlyArray<Page>;
  readonly activePage: Page;
  readonly onPageChange: (page: Page) => void;
}

export function TopBar<Page extends string>({ pages, activePage, onPageChange }: TopBarProps<Page>) {
  const { colormap, setColormap } = useColormapTheme();

  return (
    <nav className="flex h-8 shrink-0 items-center bg-chrome-surface px-2">
      {pages.map((page) => {
        const isActive = page === activePage;

        return (
          <button
            key={page}
            type="button"
            className={`mx-2 px-2 py-1 font-technical text-[length:var(--text-sm)] uppercase tracking-[0.06em] transition-colors duration-150 ${
              isActive
                ? "text-void"
                : "text-chrome-text-secondary hover:text-chrome-text"
            }`}
            onClick={() => {
              onPageChange(page);
            }}
          >
            {isActive ? <span className="bg-primary">{page}</span> : page}
          </button>
        );
      })}
      <div className="flex-1" />
      <button
        type="button"
        className="flex items-center gap-1.5 px-2 py-1 font-technical text-[length:var(--text-xs)] uppercase tracking-[0.06em] text-chrome-text-secondary transition-colors duration-150 hover:text-chrome-text"
        onClick={() => setColormap(colormap === "lava" ? "viridis" : "lava")}
        aria-label={`Switch to ${colormap === "lava" ? "viridis" : "lava"} theme`}
      >
        <Icon icon={colormap === "lava" ? "lucide:flame" : "lucide:leaf"} width={14} height={14} />
        <span>{colormap}</span>
      </button>
    </nav>
  );
}
