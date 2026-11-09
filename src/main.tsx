import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import { applyAccentToDocument, readStoredAccent } from "./features/accent/model";
import { initInstallCapture } from "./features/pwa/install";
import "./index.css";

applyAccentToDocument(readStoredAccent());
initInstallCapture();

createRoot(document.getElementById("root")!).render(<App />);
