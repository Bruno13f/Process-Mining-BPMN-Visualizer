import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import HttpBackend from "i18next-http-backend";

const savedLang = localStorage.getItem("lang") || "en";

i18n
  .use(HttpBackend)
  .use(initReactI18next)
  .init({
    lng: savedLang,
    fallbackLng: "en",
    backend: {
      loadPath: "/locales/{{lng}}/translation.json"
    }
  });

export default i18n;
