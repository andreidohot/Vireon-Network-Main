/// <reference types="vite/client" />

import type { VireonBridge } from "@shared/types";

declare global {
  interface Window {
    vireon: VireonBridge;
  }
}

export {};
