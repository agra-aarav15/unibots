import type { ServiceWorkerScope } from "./service-worker";
import { installServiceWorker } from "./service-worker";

declare const self: ServiceWorkerScope;
// Replaced with the built shell and its versioned cache name by the PWA build plugin.
declare const __UNIBOT_SW_PRECACHE__: string[];
declare const __UNIBOT_SW_CACHE__: string;

installServiceWorker(self, __UNIBOT_SW_PRECACHE__, __UNIBOT_SW_CACHE__);
