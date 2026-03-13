import { ThemeProvider } from "./components/ThemeProvider";
import { Layout } from "./components/Layout";

export function App() {
  return (
    <ThemeProvider>
      <Layout />
    </ThemeProvider>
  );
}
