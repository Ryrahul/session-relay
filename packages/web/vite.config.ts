import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    // During development, API calls go to the local server.
    proxy: { "/v1": "http://localhost:8787", "/health": "http://localhost:8787" },
  },
});
