/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />
interface ImportMetaEnv {
  /** Si l'API est hébergée sur une autre origine (ex. https://api.exemple.mg) */
  readonly VITE_API_URL?: string;
  /** Fuseau d'affichage des heures (défaut Indian/Antananarivo) */
  readonly VITE_APP_TZ?: string;
}
