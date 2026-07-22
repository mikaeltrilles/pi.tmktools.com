# π Explorer — pi.tmktools.com

Retranscription en temps réel des décimales de Pi depuis un fichier uploadé par un Raspberry.

## Fonctionnalités

- Lecture en temps réel du fichier `data/pi_complet.txt` via **Server-Sent Events**
- Affichage décimale par décimale dans le DOM avec rang coloré
- Distribution statistique des chiffres 0–9
- Recherche par rang (ex : « quelle est la 1000ème décimale ? »)
- Recherche d'une chaîne de chiffres dans les décimales disponibles
- Snapshots automatiques aux paliers 10, 20, 50, 100, 500, 1000, 5000, 1×10ⁿ et 5×10ⁿ
- Téléchargement du fichier global

## Stack

Node.js 18+ · Express 4 · Vanilla JS · Server-Sent Events

## Démarrage

```bash
npm install
npm start
# → http://localhost:3001
```

Mode développement (hot-reload natif Node.js 18+) :

```bash
npm run dev
```

Le serveur attend que le Raspberry upload `data/pi_complet.txt` (ou un fichier `data/pi_N.txt`).

## Routes API

| Méthode | Route | Description |
|---------|-------|-------------|
| GET | `/` | Frontend |
| GET | `/stream-continuous` | SSE — retranscription continue des décimales |
| GET | `/continuous-state` | État courant du fichier lu |
| GET | `/digit?rank=N` | Décimale au rang N |
| GET | `/digits-around?rank=N` | Bloc de ~500 décimales autour du rang N |
| GET | `/search-chain?q=14159` | Positions d'une chaîne de chiffres |
| GET | `/snapshots` | Liste des snapshots générés |
| GET | `/snapshot/:n` | Télécharger le snapshot `pi_n.txt` |
| GET | `/complet` | Télécharger le fichier global |
| GET | `/stats` | Métriques du fichier global |

## Architecture

```
pi.tmktools.com/
├── server.js          → Backend Express — lecture fichier + SSE
├── package.json
├── .gitignore
├── README.md
├── data/
│   ├── pi_complet.txt → Fichier uploadé par le Raspberry
│   ├── pi_N.txt       → Snapshots de paliers
│   └── pi_history.log → Historique des mises à jour
└── public/
    └── index.html     → Frontend tout-en-un
```

## Déploiement

### Déploiement autonome (code + données π)

Le script `deploy-with-data.sh` fait tout en une seule commande :

```bash
./deploy-with-data.sh "fix(data): mise à jour des 13M décimales"
```

Il effectue automatiquement :
1. La copie de `../PIpi4/pi_complet.txt` vers `data/pi_complet.txt`
2. Le commit & push sur GitHub
3. Le déploiement du code sur le serveur (rsync, ou scp en fallback Windows)
4. L'upload atomique de `pi_complet.txt` sur le serveur de production
5. Le rechargement PM2 du serveur Node.js
6. Une vérification finale du nombre de décimales exposées

### Déploiement du code seul

```bash
./deploy.sh "feat(ui): nouvelle couleur"
```

Ce script déploie uniquement le code Node.js/Express/JS. Le fichier `data/pi_complet.txt` n'est pas modifié sur le serveur.

### Synchronisation locale PIpi4 → picalc

Pour faire pointer le site local sur les dernières décimales calculées par le Raspberry :

```bash
./sync-pi-data.sh
```

Puis redémarrez le serveur local, ou cliquez sur **Resync** dans l'interface web.

### Snapshot protecteur

Si le Raspberry ecrase accidentellement `pi_complet.txt` avec un fichier plus petit (redemarrage a zero, bug de checkpoint...), le site web bascule automatiquement sur le snapshot `pi_20000000.txt` (contenant les 13+ millions de decimales deja atteintes), car le serveur choisit toujours la source π la plus fournie.

Pour regenerer et uploader ce snapshot protecteur :

```bash
./deploy-protect-snapshot.sh
```

### Mise a jour du calculateur Raspberry

Le calculateur sur le Raspberry doit avoir la derniere version de `calculate_pi.py` pour eviter les regressions. Pour le mettre a jour :

```bash
cd ../PIpi4
./deploy-to-raspberry.sh
```

### Serveur local

```bash
npm install
npm start
# → http://localhost:3001
```

Le serveur détecte automatiquement la source π la plus fournie :
- `data/pi_complet.txt`
- `../PIpi4/pi_complet.txt`
- ou un fichier forcé via `PI_SOURCE_FILE=/chemin/vers/pi_complet.txt npm start`

### Reverse proxy Apache

```apache
RewriteEngine On
RewriteBase /
RewriteRule ^(.*)$ http://127.0.0.1:3001/$1 [P,L]
```

---

© pi.tmktools.com
