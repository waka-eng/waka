import React from "react";
import ReactDOM from "react-dom/client";

import { App } from "./App";

const root = document.getElementById("root");
if (!root) {
  throw new Error("Could not find #root element to mount the WAKA admin app.");
}

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
