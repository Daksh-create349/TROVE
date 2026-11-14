import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import { AppProvider } from "./context/AppContext";
import { AuthProvider } from "./context/AuthContext";
import { TransferProvider } from "./context/TransferContext";
import { ErrorBoundary } from "./components/common/ErrorBoundary";
import "./index.css";

const rootElement = document.getElementById("root");

if (rootElement) {
  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <ErrorBoundary>
        <AppProvider>
          <AuthProvider>
            <TransferProvider>
              <App />
            </TransferProvider>
          </AuthProvider>
        </AppProvider>
      </ErrorBoundary>
    </React.StrictMode>
  );
}

