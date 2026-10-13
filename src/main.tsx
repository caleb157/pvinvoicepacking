import { createRoot } from "react-dom/client";
import App from "./App";
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
import "./index.css";

// Follow the system light/dark setting (same tokens as HQ).
const dark = window.matchMedia?.("(prefers-color-scheme: dark)");
const apply = () => document.documentElement.classList.toggle("dark", !!dark?.matches);
apply();
dark?.addEventListener?.("change", apply);

createRoot(document.getElementById("root")!).render(<App />);
