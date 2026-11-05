import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import { initInstallCapture } from "./features/pwa/install";
import "./index.css";

initInstallCapture();

createRoot(document.getElementById("root")!).render(<App />);
