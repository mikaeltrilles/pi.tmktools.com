# 🥧 pi.tmktools.com — Calcul et retranscription en temps réel des décimales de π

Dépôt de travail **unique** regroupant les deux moitiés du projet :

| Dossier | Rôle |
|---------|------|
| `calculator/` | Calcul **infini** des décimales de π (algorithme de **Chudnovsky**, BigInt Python), supervisé par systemd sur le poste Linux. Produit `calculator/pi_complet.txt` et l'uploade automatiquement en production. |
| racine + `public/` + `data/` | Site **https://pi.tmktools.com** : serveur Node.js/Express qui lit `pi_complet.txt`, diffuse les décimales en Server-Sent Events, génère les snapshots `pi_N.txt` et expose une page de statut. |
| `scripts/` | Déploiement en production (o2switch, PM2 sur le port 3001), synchronisation des données, surveillance PM2. |
| `docs/` | Mémo des commandes utiles. |

> Historique : `calculator/` est l'ancien dépôt `PIpi4` (calculateur, jadis sur un Raspberry Pi 4) et la racine est l'ancien dépôt `picalc`. Les deux historiques git ont été fusionnés le 5 septembre 2026 (voir `git log`).

## 📁 Arborescence

```
pi.tmktools.com/
├── server.js                 → Backend Express : lecture de pi_complet.txt + SSE + API
├── package.json / package-lock.json
├── ecosystem.config.js       → Configuration PM2 (production)
├── .htaccess                 → Apache : proxy inverse de tout le site vers Node (port 3001)
├── public/
│   ├── index.html            → Frontend tout-en-un
│   ├── status.html           → Page d'état du service (/api/health)
│   └── favicon.svg
├── data/                     → (non versionné) données servies par le site
│   ├── pi_complet.txt        → copie déployée / uploadée du fichier π
│   ├── pi_N.txt              → snapshots : 10, 20, …, 900 000 puis UN PAR MILLION (1 M, 2 M, …)
│   └── calculator_heartbeat.json, health_state.json, pi_history.log
├── calculator/
│   ├── calculate_pi.py       → Programme principal de calcul (mode infini, reprise, upload)
│   ├── pi-calculate.service  → Unité systemd utilisateur (copie de référence)
│   ├── run_background.sh     → Lancement manuel en tâche de fond (Linux)
│   ├── watch_and_restart.sh  → Watchdog (relance si le processus meurt)
│   ├── rebuild_checkpoint.py → Reconstruction d'un checkpoint depuis un nombre de décimales
│   ├── run_local.ps1 / run_local.bat / stop_local.ps1 → lanceurs Windows
│   ├── tests/                → tests de l'algorithme (test_chud*.py)
│   └── (non versionné) pi_complet.txt, pi_checkpoint.json, pi_progress.txt,
│       pi_calculate.log, pi_calculate.pid, pi_calculate.lock, calculator_heartbeat.json
├── scripts/
│   ├── deploy.sh                    → Déploie le code seul (rsync + PM2 reload)
│   ├── deploy-with-data.sh          → Déploie code + pi_complet.txt
│   ├── sync-pi-data.sh              → Copie calculator/pi_complet.txt → data/
│   ├── sync-and-deploy.sh           → sync-pi-data + deploy-with-data
│   ├── remote-keepalive.sh          → (côté serveur, cron) relance PM2 si le port 3001 ne répond plus
│   ├── install-remote-keepalive.sh  → Installe le cron ci-dessus sur le serveur
│   ├── remote-status.sh             → État PM2 / port / décimales publiées
│   └── legacy/                      → anciens scripts Raspberry Pi (conservés pour mémoire)
└── docs/commandes-utiles.txt
```

## 🔗 Flux de données

```
calculator/calculate_pi.py ──écrit──▶ calculator/pi_complet.txt ──scp (chaque palier)──▶ serveur : ~/pi.tmktools.com/data/pi_complet.txt
        │                                        │                                                     │
        └── heartbeat toutes les 60 s ───────────┼──scp──▶ data/calculator_heartbeat.json              │
                                                 │                                                     ▼
                                    server.js local lit directement                       server.js (PM2, port 3001) ◀── Apache (.htaccess)
                                    calculator/pi_complet.txt                              https://pi.tmktools.com
```

Le serveur choisit **toujours la source la plus fournie** parmi `data/pi_complet.txt`, `calculator/pi_complet.txt` et les snapshots `data/pi_N.txt` : un fichier plus petit ne peut jamais faire régresser l'affichage. Le calculateur applique la même règle avant chaque upload.

---

## 🧮 Calculateur (`calculator/`)

### Caractéristiques

- **♾️ Calcul non borné** par paliers de 1000 décimales, jusqu'à arrêt manuel.
- **🔄 Reprise automatique** depuis `pi_checkpoint.json` (écriture atomique).
- **💾 Sauvegardes locales** : les 3 dernières copies de `pi_complet.txt` dans `/home/mitchlab/Documents`.
- **☁️ Upload automatique** de `pi_complet.txt`, du checkpoint (avec historique des 10 derniers) et d'un heartbeat vers `vote1550@109.234.165.174:/home/vote1550/pi.tmktools.com/data/`.
- **🛡️ Anti-régression** : un fichier local moins avancé n'écrase jamais le distant ; un checkpoint distant plus avancé est adopté au démarrage.
- **📸 Snapshots** : le site génère `data/pi_N.txt` pour 10, 20, …, 900 000 puis tous les millions de décimales, uniquement quand N décimales existent réellement ; un snapshot dont l'en-tête ne correspond pas à son nom est supprimé au démarrage.
- **📸 Secours** : sans checkpoint valide, l'état est reconstruit depuis le meilleur snapshot (distant, backups locaux, snapshots `data/pi_N.txt`).
- **🔒 Verrou** `pi_calculate.lock` contre les doubles instances ; **📝 log** `pi_calculate.log` avec emojis ; **👁️ aperçu** `pi_progress.txt`.

Le script se place lui-même dans `calculator/` au démarrage : il peut être lancé depuis n'importe quel répertoire courant.

### Exécution permanente sous Linux (systemd) — mode recommandé

Unité : `~/.config/systemd/user/pi-calculate.service` (copie de référence : `calculator/pi-calculate.service`).

```bash
systemctl --user status pi-calculate.service     # état
systemctl --user start|stop|restart pi-calculate.service
systemctl --user enable pi-calculate.service     # démarrage au boot
journalctl --user -u pi-calculate.service -n 50  # tracebacks éventuels (le log métier reste calculator/pi_calculate.log)
tail -f calculator/pi_calculate.log              # progression
```

Points importants :

- `loginctl show-user mitchlab -p Linger` doit renvoyer `Linger=yes` (sinon : `loginctl enable-linger mitchlab`).
- `TimeoutStopSec=2400` : à l'arrêt, le script termine le palier en cours (≈ 40 min à 18,5 M de décimales) avant d'écrire son checkpoint. Un arrêt brutal ne perd que le palier en cours, jamais le checkpoint précédent.
- Après modification de `calculator/pi-calculate.service` : `cp calculator/pi-calculate.service ~/.config/systemd/user/ && systemctl --user daemon-reload && systemctl --user restart pi-calculate.service`.

### Lancement manuel

```bash
systemctl --user stop pi-calculate.service        # obligatoire : run_background.sh refuse de démarrer si le service est actif
calculator/run_background.sh                      # mode infini
calculator/run_background.sh --digits 50000       # mode fini
calculator/run_background.sh --reset              # repart de zéro
```

Sous Windows : `calculator\run_local.ps1 [-Digits N] [-Reset]` et `calculator\stop_local.ps1`.

### Prérequis

- Python 3.9+ (BigInt natif, `zoneinfo`).
- Clé SSH autorisée vers la production : `ssh -F /dev/null -o BatchMode=yes vote1550@109.234.165.174 echo OK` (`-F /dev/null` contourne une configuration SSH système invalide sur le poste).

### Format de l'en-tête de `pi_complet.txt`

```text
# Pi Complet made with ♥ by PI RasberryPi4
# Derniere mise a jour : 2026-09-05T18:47:54.000+02:00
# Nombre total de decimales : 18,520,659
# Algorithme : Chudnovsky (BigInt)
#
3.14159265358979323846264338327950288419716939937510...
```

---

## 🌐 Site (`server.js`, `public/`, `data/`)

### Démarrage local

```bash
npm install
npm start          # → http://localhost:3001, lit calculator/pi_complet.txt en direct
npm run dev        # hot-reload
PI_SOURCE_FILE=/chemin/pi_complet.txt npm start   # forcer une source
```

Stack : Node.js 18+ · Express 4 · Vanilla JS · Server-Sent Events.

### Routes API

| Méthode | Route | Description |
|---------|-------|-------------|
| GET | `/` | Frontend |
| GET | `/api/health` | Page de statut du service |
| GET | `/api/health/data` | Données JSON de supervision (heartbeat calculateur, continuité…) |
| GET | `/stream-continuous` | SSE — retranscription continue des décimales |
| GET | `/continuous-state` | État courant du fichier lu |
| GET | `/digit?rank=N` | Décimale au rang N |
| GET | `/digits-around?rank=N` | Bloc de ~500 décimales autour du rang N |
| GET | `/search-chain?q=14159` | Positions d'une chaîne de chiffres |
| GET | `/snapshots` · `/snapshot/:n` | Liste / téléchargement des snapshots `pi_n.txt` |
| GET | `/complet` | Télécharger le fichier global |
| GET | `/stats` | Métriques du fichier global |
| POST | `/refresh-file` | Forcer une relecture immédiate du fichier |

---

## 🚀 Production (o2switch, `vote1550@109.234.165.174`)

- Dossier distant : `/home/vote1550/pi.tmktools.com` ; Node 22 ; PM2 (`ecosystem.config.js`, app `pi-tmktools`, port 3001).
- Apache (`.htaccess`) proxifie **tout** vers `http://127.0.0.1:3001`. Si rien n'écoute sur ce port, Apache renvoie **503 Service Unavailable**.

```bash
scripts/deploy.sh "feat(ui): …"               # code seul (git commit+push, rsync, npm install, pm2 reload)
scripts/deploy-with-data.sh "deploy(data): …"  # code + pi_complet.txt
scripts/remote-status.sh                       # état PM2 / port 3001 / décimales
```

### Surveillance PM2 (anti-503)

Sur l'hébergement mutualisé, le démon PM2 peut être tué (c'est ce qui a provoqué le 503 du 5 septembre 2026 : plus aucun processus PM2, port 3001 muet). `scripts/remote-keepalive.sh` est prévu pour tourner **sur le serveur** en cron toutes les 5 minutes : il teste `http://127.0.0.1:3001/stats` et relance `pm2 startOrRestart ecosystem.config.js` si nécessaire (journal : `~/pi.tmktools.com/logs/keepalive.log`).

```bash
scripts/install-remote-keepalive.sh    # (ré)installe le script et le cron sur le serveur
```

Relance manuelle : `ssh -F /dev/null vote1550@109.234.165.174 'cd ~/pi.tmktools.com && npx pm2 startOrRestart ecosystem.config.js && npx pm2 save'`.

---

## 🛠️ Architecture du calcul

Version **incrémentale** de la formule de Chudnovsky :

```
π = C · √10005 / S,   S = Σ (-1)^k (6k)! (13591409 + 545140134k) / ((3k)! (k!)³ (-640320³)^k)
```

La somme partielle est maintenue sous la forme `S_n = P_n / (-640320³)^n`, ce qui permet d'ajouter des termes par blocs sans recalculer la série (≈ 14,18 décimales par terme). Tests : `python3 calculator/tests/test_chud_incremental.py`.

## 📝 Licence

Projet personnel — fait avec ♥.
