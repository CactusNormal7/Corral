import { createApp } from "vue";
import { createPinia } from "pinia";
import PrimeVue from "primevue/config";
import Aura from "@primeuix/themes/aura";
import ConfirmationService from "primevue/confirmationservice";
import ToastService from "primevue/toastservice";
import Tooltip from "primevue/tooltip";
import App from "./App.vue";
import "primeicons/primeicons.css";
import "@xterm/xterm/css/xterm.css";
import "./assets/main.css";

createApp(App)
  .use(createPinia())
  .use(PrimeVue, {
    // Le thème suit le réglage du système : une app de pilotage reste ouverte
    // à côté d'un terminal, elle doit s'accorder avec lui.
    theme: { preset: Aura, options: { darkModeSelector: "system" } },
    locale: {
      // L'UI est en français ; PrimeVue n'embarque pas de locale par défaut.
      emptyMessage: "Aucun résultat",
      emptyFilterMessage: "Aucun résultat",
    },
  })
  .use(ConfirmationService)
  .use(ToastService)
  .directive("tooltip", Tooltip)
  .mount("#app");
