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

Le serveur écoute sur le port `3001`. Mettez-le derrière un reverse proxy
(Apache/Nginx) avec buffering désactivé pour les SSE.

### Apache

```apache
RewriteEngine On
RewriteBase /
RewriteRule ^(.*)$ http://127.0.0.1:3001/$1 [P,L]
```

---

© pi.tmktools.com
