import { createRoot } from "react-dom/client";
import { FishjamProvider } from "@fishjam-cloud/react-client";
import App from "./App";
import "./index.css";

const FISHJAM_ID = import.meta.env.VITE_FISHJAM_ID as string | undefined;

console.log("FISHJAM_ID", FISHJAM_ID);

if (!FISHJAM_ID) {
  throw new Error(
    "Missing VITE_FISHJAM_ID. Set it in frontend/.env and restart the Vite dev server.",
  );
}

createRoot(document.getElementById("root")!).render(
  <FishjamProvider fishjamId={FISHJAM_ID} debug>
    <App />
  </FishjamProvider>,
);
