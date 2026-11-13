import type { CorralApi } from "../../shared/ipc-contract.js";

declare global {
  interface Window {
    corral: CorralApi;
  }
}

export {};
