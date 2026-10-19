# Resto Manager — application mobile Android (React Native / Expo)

Même serveur et mêmes comptes que la version web. Écrans : **Caisse** (tables), **Nouvelle vente** (liste déroulante des plats + quantités), **Commandes**, **Tableau de bord** (gérant seulement), **Réglages**.
Hors-ligne : menu/tables en cache, commandes et encaissements gardés sur le téléphone puis envoyés automatiquement (sans doublon).

## 1. Tester tout de suite (sans compiler)
1. Installez **Expo Go** sur le téléphone (Play Store).
2. Sur l'ordinateur : `cd apps/mobile && npm install && npx expo start`
3. Scannez le QR code (téléphone et PC sur le même Wi-Fi).
4. À l'écran de connexion, saisissez l'adresse du serveur (ex. `http://192.168.1.20:3000` en local, ou `https://resto.exemple.mg`).

## 2. Produire l'APK à installer (compte Expo gratuit)
```bash
cd apps/mobile
npm install
npm install -g eas-cli
eas login
eas build:configure          # accepte les valeurs proposées (Android)
eas build -p android --profile preview
```
Au bout de quelques minutes EAS donne un lien de téléchargement du fichier **.apk** : ouvrez-le sur le téléphone (autoriser « sources inconnues »), ou partagez le lien/fichier aux caissiers.
Compilation locale possible avec Android Studio : `npx expo prebuild -p android && cd android && ./gradlew assembleRelease`.

## 3. Adresse du serveur par défaut
Dans `app.json` : `expo.extra.defaultApiUrl`. Elle reste modifiable dans l'appli (écran de connexion ou Réglages).
Utilisez **HTTPS** en production. `usesCleartextTraffic` est activé uniquement pour tester en HTTP sur le réseau local : passez-le à `false` dans `app.json` pour l'APK final.

## 4. Impression
- **RawBT** (recommandé pour imprimante thermique Bluetooth/USB) : installez l'appli gratuite « RawBT » et associez l'imprimante ; les tickets partent en ESC/POS sans fenêtre.
- **Impression Android** : service d'impression du téléphone (Wi-Fi, PDF, plugin du fabricant).
Choix dans Réglages ; le bouton « Imprimer un ticket de test » vérifie la chaîne.

## Structure
```
app/            écrans (expo-router) : login, (tabs)/…, table/[id]
src/lib/        api, auth (SecureStore), outbox hors-ligne, realtime WebSocket, escpos/ticket, print
src/components/ UI et fenêtre d'encaissement
```
Les schémas Zod, droits et types viennent de `packages/shared` (config Metro dans `metro.config.js`).
