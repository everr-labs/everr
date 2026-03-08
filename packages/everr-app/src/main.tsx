import React from "react";
import ReactDOM from "react-dom/client";
import { ThemeProvider } from "better-themes";
import App from "./App";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ThemeProvider attribute="class" disableTransitionOnChange>
      <App />
    </ThemeProvider>
  </React.StrictMode>,
);
