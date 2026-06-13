# π Calculator — pi.tmktools.com

Calcul live des décimales de Pi avec précision arbitraire.

## Fonctionnalités

- Calcul en temps réel via **Server-Sent Events**
- Algorithme de **Machin** avec `BigInt` natif Node.js (thread worker)
- Affichage coloré avec le **rang** de chaque décimale
- Distribution statistique des chiffres 0–9
- Recherche par rang (ex : « quelle est la 1000ème décimale ? »)
- Sauvegarde et téléchargement du fichier `pi_digits.txt`

## Stack

Node.js 18+ · Express 4 · Vanilla JS · Server-Sent Events

## Démarrage

```bash
npm install
npm start
# → http://localhost:3000
```

Mode développement (hot-reload natif Node.js 18+) :

```bash
npm run dev
```

## Routes API

| Méthode | Route | Description |
|---------|-------|-------------|
| GET | `/` | Frontend |
| GET | `/stream?n=1000` | SSE — blocs de 50 chiffres toutes les 150 ms |
| GET | `/digits?n=100` | JSON synchrone |
| POST | `/save` | Sauvegarde dans `data/pi_digits.txt` |
| GET | `/stored` | Contenu du fichier stocké (text/plain) |
| GET | `/stats` | Métriques du fichier stocké |

## Architecture

```
pi.tmktools.com/
├── server.js          → Backend Express + worker_threads
├── package.json
├── .gitignore
├── README.md
├── data/
│   ├── pi_digits.txt  → Dernière sauvegarde
│   └── pi_history.log → Historique des sauvegardes
└── public/
    └── index.html     → Frontend tout-en-un
```

## Déploiement

Le serveur écoute sur le port `3000`. Mettez-le derrière un reverse proxy
(Apache/Nginx) avec buffering désactivé pour les SSE.

### Nginx (recommandé)

```nginx
location / {
    proxy_pass         http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_buffering    off;
    proxy_cache        off;
}
location /stream {
    proxy_pass         http://127.0.0.1:3000/stream;
    proxy_buffering    off;
    proxy_read_timeout 3600s;
    add_header X-Accel-Buffering "no";
}
```

---

© pi.tmktools.com
