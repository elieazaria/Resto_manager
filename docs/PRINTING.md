# Impression des tickets

Le ticket est généré côté appareil (donc **même hors-ligne**) à partir du réglage *Restaurant et ticket* : nom, adresse, téléphone, pied de page, largeur du papier (58 mm = 32 colonnes ; 80 mm = 42 ou 48 colonnes selon le modèle).

## Choisir son terminal
Une **imprimante thermique ESC/POS** 58 ou 80 mm (Epson TM-T20/T88, Xprinter, Rongta, Munbyn… très répandues). Connectique : USB (PC), Bluetooth (téléphone/tablette Android) ou réseau (Ethernet/Wi-Fi). Prenez un modèle avec **coupe automatique** pour la caisse.

## Mode « Navigateur »
Ticket mis en page pour le papier thermique (`@media print`). L'imprimante doit être installée sur l'appareil.
- **PC de caisse (recommandé)** : lancez Chrome en `--kiosk-printing` (ex. `chrome --kiosk-printing --app=https://votre-url`) avec l'imprimante thermique par défaut : l'impression part **sans boîte de dialogue**.
- Sans cette option, la boîte d'impression du navigateur s'ouvre à chaque ticket.

## Mode « RawBT » (Android)
1. Installez **RawBT** (Play Store) et associez l'imprimante Bluetooth ou USB.
2. Dans l'application : menu utilisateur → *Impression* → mode *RawBT*.
3. L'application envoie du **ESC/POS brut** (accents retirés pour éviter les pages de codes) via le lien `rawbt:base64,…` : impression directe, sans dialogue, avec coupe.

## Tester
*Impression* → **Imprimer un ticket de test**. Si le texte déborde ou est trop étroit, changez la largeur du papier dans *Restaurant et ticket*.

## Pistes
Impression directe en Web Bluetooth/WebUSB (sans RawBT), tickets séparés cuisine/bar par catégorie, ouverture automatique du tiroir-caisse (commande ESC/POS `ESC p`).
