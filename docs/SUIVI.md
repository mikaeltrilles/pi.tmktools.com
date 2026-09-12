# Journal de suivi — pi.tmktools.com

Journal des interventions, état courant et prochaines étapes. Une entrée par journée
de travail, la plus récente en haut. Le détail technique est dans `git log` et le README.

---

## 2026-09-12 — Panne 503 : le filet de sécurité avait été retiré

### Incident

Le site répondait « 503 Service Unavailable » : le processus Node `pi-tmktools`
n'était plus dans PM2 et le port 3001 était muet. Le démon PM2 tournait pourtant
(l'application `linkfree` était en ligne depuis 33 h) : seul notre processus avait
été tué, sans être relevé.

**Cause racine** : la crontab du compte, réassemblée le jour même à 14 h 55 par
`~/cron/apply-crontab.sh`, avait relégué le contrôle de disponibilité de π dans le
fragment `60-autres.cron`, **commenté**, sous l'intitulé « tâches sans activité
récente ». Le critère retenu était un journal `logs/keepalive.log` vide — or ce
journal est vide **parce que** `remote-keepalive.sh` est silencieux tant que le
site répond. Le seul garde-fou contre le 503 a donc été retiré quelques minutes
avant que la panne ne survienne, et plus rien ne pouvait relever le site.

### Fait

- **Remise en ligne** : `npx pm2 startOrRestart ecosystem.config.js` puis
  `npx pm2 save` sur le serveur. Site et API de nouveau en HTTP 200.
- **Fragment cron dédié et versionné** : `scripts/cron/55-pi.cron`, avec en tête un
  avertissement explicite « journal vide ≠ tâche inactive », pour que le contrôle ne
  soit plus désactivé sur ce critère.
- **`scripts/install-remote-keepalive.sh` réécrit** : il écrivait la crontab en
  direct, ce qui, depuis le passage aux fragments (11 septembre), aurait été effacé
  au prochain assemblage. Il dépose désormais le fragment dans `~/cron/cron.d/`,
  retire toute ligne héritée d'un autre fragment, puis appelle `apply-crontab.sh`.
- **`scripts/remote-keepalive.sh`** : en-tête complété sur le silence volontaire.
- **`docs/crontab-serveur.txt` réécrit** : organisation par fragments, procédure de
  remise en place, et les deux pièges connus (wrapper CageFS, journal vide).

### Reste à faire

L'application du crontab n'est pas réalisable en mode automatique (Claude ne peut
pas modifier de crontab) : la commande exacte est dans `docs/crontab-serveur.txt`,
à lancer dans un terminal. **Tant qu'elle n'est pas lancée, le site n'a aucun filet
et un nouveau 503 resterait sans relance automatique.**

### Vérifications

- Production : `/`, `/stats`, `/api/health`, `/continuous-state`, `/snapshots`,
  `/styles.css`, `/sw.js`, `/manifest.webmanifest` en HTTP 200.
- `/stats` cohérent avec le calculateur : 18 770 256 décimales.
- Calculateur local : `pi-calculate.service` actif, publication en production à jour.

### Leçon

Un contrôle silencieux doit **annoncer son silence** là où on risque de le juger :
dans le fragment cron lui-même. Le même raisonnement vaut pour les tâches
`--quiet-ok` du CRM, qui pourraient être désactivées par le même critère.

## 2026-09-06 — Interface homogène avec φ, PWA, correctifs mobile

### Fait

- **Interface réalignée sur phi.tmktools.com** : nouveau `public/styles.css` (mêmes
  jetons, polices auto-hébergées, composants), `index.html` restructuré (en-tête,
  hero π + formule de Chudnovsky, cartes Retranscription / Explorer / Comprendre / À
  propos, pied de page croisé), logique extraite dans `public/app.js`, `status.html`
  réécrit sans Bootstrap. Accent cyan pour π, doré pour φ. Commit `b21ffc6`.
- **Application installable (PWA)** : bouton « Installer l'application », manifeste,
  service worker écrit à la main (coquille en cache, contenu vivant toujours réseau),
  bandeau de mise à jour, icônes et image Open Graph générées par
  `scripts/generate-icons.mjs`. Commit `2742412`.
- **Mobile** : hero centré et formule sans débordement horizontal de 320 à 768 px.
  Commit `1c0f6e1`.
- **Service worker versionné au déploiement** : `scripts/deploy.sh` dérive la
  constante `VERSION` de `public/sw.js` du contenu de `public/`. Commit `0f12f51`.
- **Cron keepalive installé sur le serveur** (toutes les 5 min) par Mika via un
  terminal externe ; crontab serveur complet (acme.sh, GeoIP, keepalive) vérifié.
- **Instructions permanentes** : `CLAUDE.md` à la racine (commit `b912345`).
- **Un seul snapshot téléchargeable** : le site ne conserve plus que le fichier du
  dernier palier atteint (`data/pi_18000000.txt` aujourd'hui) ; les paliers
  précédents sont supprimés automatiquement et le suivant remplacera l'actuel.
  Carte « Dernier palier » dans l'interface, documentation et `CLAUDE.md` mis à jour.

### Vérifications

- Playwright bureau/mobile, sombre/clair, aucune erreur console, aucun débordement.
- Production : ressources en HTTP 200, service worker actif, flux SSE « Connecté »,
  compteur à 18,53 M de décimales.

### État en fin de journée

| Élément | État |
|---------|------|
| Site https://pi.tmktools.com | En ligne, nouvelle interface, PWA, un seul snapshot (18 M) |
| PM2 `pi-tmktools` (port 3001) | En ligne, surveillé par cron toutes les 5 min |
| Calculateur `pi-calculate.service` | Actif depuis `pi.tmktools.com/calculator`, ≈ 18,53 M décimales |
| Dépôt GitHub `mikaeltrilles/pi.tmktools.com` | À jour (`main`), arbre propre |
| Crontab serveur | acme.sh + update-geoip + remote-keepalive ✔ |

### À faire

- [ ] Nettoyer le crontab **local** du poste (trois lignes destinées au serveur) :
      `crontab -r` dans un terminal local ; sauvegarde dans
      `~/crontab-local-sauvegarde-2026-09-05.txt`.
- [ ] Supprimer l'archive `Developpement/_archive-2026-09-05-fusion-pi-tmktools/`
      (anciens dossiers PIpi4 et picalc) une fois certain de ne plus en avoir besoin.
- [ ] Optionnel : ajouter `sharp` en vraie dépendance de dev locale
      (`npm install --save-dev sharp`) au lieu du lien vers `phi.tmktools.com/node_modules`.
- [ ] Optionnel : page 404 sur le même design, et `robots.txt` / `sitemap.xml`
      comme sur φ.

---

## 2026-09-05 — Panne 503, fusion des dépôts, snapshots

### Fait

- **503 Service Unavailable** : diagnostic (démon PM2 mort sur l'hébergement, port
  3001 muet), relance de l'application, écriture de `scripts/remote-keepalive.sh`,
  `install-remote-keepalive.sh` et `remote-status.sh`.
- **Fusion PIpi4 + picalc** dans le répertoire unique `pi.tmktools.com/` avec
  conservation des deux historiques git (subtree merge), calculateur dans
  `calculator/`, scripts dans `scripts/`, README unique, `.gitignore` fusionné.
  Commits `d16d0f9`, `8fb7254`.
- **Bascule du calculateur** : arrêt propre via systemd, copie des fichiers de
  travail, unité `pi-calculate.service` pointée sur le nouveau dossier, relance
  vérifiée (heartbeat publié en production). Anciens dossiers archivés.
- **Snapshots** : un fichier par million au-delà de 1 M (11 M → 18 M créés),
  suppression du faux `pi_20000000.txt`, nettoyage automatique des snapshots dont
  l'en-tête ne correspond pas au nom. Commit `e3928dc`.
- **Crontab serveur** : découverte du piège du wrapper CageFS (la forme en tube
  efface le crontab), correction du script d'installation, crontab de référence
  dans `docs/crontab-serveur.txt`. Commit `203af9d`.

### Leçons

- Sur ce serveur, ne jamais écrire le crontab avec `( crontab -l ; echo … ) | crontab -`.
- Un arrêt propre du calculateur peut durer 40 min ; un palier perdu n'est pas grave,
  le checkpoint précédent reste valide.
