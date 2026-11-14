import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import { AppProvider } from "./context/AppContext";
import { AuthProvider } from "./context/AuthContext";
import { TransferProvider } from "./context/TransferContext";
import "./index.css";

const rootElement = document.getElementById("root");

if (rootElement) {
  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <AppProvider>
        <AuthProvider>
          <TransferProvider>
            <App />
          </TransferProvider>
        </AuthProvider>
      </AppProvider>
    </React.StrictMode>
  );
}

