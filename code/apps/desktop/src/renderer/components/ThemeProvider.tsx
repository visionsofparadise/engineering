import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { Theme } from "../models/State/App";
import type { AppContext } from "../models/Context";

interface ThemeContextValue {
	theme: Theme;
	setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

const applyThemeToDocument = (theme: Theme, systemPrefersDark: boolean) => {
	const isDark = theme === "dark" || (theme === "system" && systemPrefersDark);

	if (isDark) {
		document.documentElement.classList.add("dark");
	} else {
		document.documentElement.classList.remove("dark");
	}
};

interface ThemeProviderProps {
	children: React.ReactNode;
	context: AppContext;
}

export const ThemeProvider: React.FC<ThemeProviderProps> = ({ children, context }) => {
	const { app, appStore } = context;

	const [systemPrefersDark, setSystemPrefersDark] = useState(() => window.matchMedia("(prefers-color-scheme: dark)").matches);

	useEffect(() => {
		const media = window.matchMedia("(prefers-color-scheme: dark)");

		const handleChange = (event: MediaQueryListEvent) => {
			setSystemPrefersDark(event.matches);
		};

		media.addEventListener("change", handleChange);

		return () => media.removeEventListener("change", handleChange);
	}, []);

	useEffect(() => {
		applyThemeToDocument(app.theme, systemPrefersDark);
	}, [app.theme, systemPrefersDark]);

	const setTheme = useCallback(
		(newTheme: Theme) => {
			appStore.mutate(app, (proxy) => {
				proxy.theme = newTheme;
			});
		},
		[appStore, app],
	);

	const value = useMemo(() => ({ theme: app.theme, setTheme }), [app.theme, setTheme]);

	return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
};

export const useTheme = (): ThemeContextValue => {
	const context = useContext(ThemeContext);

	if (!context) {
		throw new Error("useTheme must be used within a ThemeProvider");
	}

	return context;
};
