import { useEffect, useState } from "react";
import { TopBar } from "./TopBar";
import { ThemeContext } from "./ThemeContext";
import type { ColormapTheme } from "@engineering/design-system";
import { ShowcasePage } from "./pages/ShowcasePage";
import { HomePage } from "./pages/HomePage";
import { GraphPage } from "./pages/GraphPage";
import { SpectralPage } from "./pages/SpectralPage";

const PAGES = ["Showcase", "Home", "Graph", "Spectral Display"] as const;

type Page = (typeof PAGES)[number];

const PAGE_COMPONENTS: Record<Page, React.FC> = {
  "Showcase": ShowcasePage,
  "Home": HomePage,
  "Graph": GraphPage,
  "Spectral Display": SpectralPage,
};

export function App() {
  const [activePage, setActivePage] = useState<Page>("Showcase");
  const [colormap, setColormap] = useState<ColormapTheme>("lava");

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", colormap);
  }, [colormap]);

  const ActiveComponent = PAGE_COMPONENTS[activePage];

  return (
    <ThemeContext value={{ colormap, setColormap }}>
      <div className="flex h-screen w-screen flex-col bg-chrome-base text-chrome-text">
        <TopBar
          pages={PAGES}
          activePage={activePage}
          onPageChange={setActivePage}
        />
        <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="flex min-h-0 flex-1 flex-col overflow-auto">
            <ActiveComponent />
          </div>
        </main>
      </div>
    </ThemeContext>
  );
}
