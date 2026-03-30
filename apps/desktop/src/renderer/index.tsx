import "./index.css";
import { createRoot } from "react-dom/client";
import { App } from "./App";

// eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- root element guaranteed in index.html
createRoot(document.getElementById("root")!).render(<App />);
