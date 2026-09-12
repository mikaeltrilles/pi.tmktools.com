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

### Fausse piste : les « 429 » de Playwright

Le contrôle d'interface montrait la page « Hors ligne », sans css ni js, avec des
« 429 Too Many Requests » sur presque toutes les ressources — y compris après
plusieurs minutes sans aucune requête. Conclusion tentante : le site restait cassé
pour tout le monde. C'était faux.

Huit requêtes `curl` simultanées passaient toutes en 200. La différence tenait au
**User-Agent** : celui de Playwright contient « HeadlessChrome », qu'o2switch
identifie comme un robot. Vérification directe, trois requêtes de chaque :

    UA « HeadlessChrome » → 200, 429, 429
    UA « Chrome » normal  → 200, 200, 200

Avec un agent ordinaire, tout revient en 200, le flux SSE affiche « Connecté » et
l'état « Calcul actif ». Le site était sain depuis la relance de PM2.

Deux conséquences : `scripts/verif-prod.mjs` force désormais un agent ordinaire, et
`CLAUDE.md` le rappelle — sans cette précaution, tout contrôle d'interface conclut
à une panne inexistante.

Une modification de la politique de cache du `.htaccess` (polices et icônes servies
en `no-store`, rechargées à chaque visite) avait été rédigée tant que les 429
semblaient venir d'une rafale de requêtes. Elle a été **annulée** : sa justification
ne tenait plus, et le `no-store` global est un choix délibéré. L'observation reste
valable en soi — environ 55 Ko de polices rechargés à chaque visite — mais c'est une
optimisation à décider, pas un correctif d'incident.

### Vérifications

- Production : `/`, `/stats`, `/api/health`, `/continuous-state`, `/snapshots`,
  `/styles.css`, `/sw.js`, `/manifest.webmanifest` en HTTP 200.
- `/stats` cohérent avec le calculateur : 18 770 256 décimales.
- `scripts/verif-prod.mjs` : quatre configurations conformes (bureau et mobile,
  sombre et clair, jusqu'à 320 px) — flux SSE connecté, calcul actif, aucune erreur
  console, aucun débordement horizontal.
- Calculateur local : `pi-calculate.service` actif, publication en production à jour.

### Le calculateur passe à GMP : environ 690 fois plus rapide

Le calcul passait l'essentiel de son temps dans une racine carrée entière
réimplémentée en boucle de Newton, en Python pur. À la taille réelle de l'appel
dans `evaluate_pi` (37 millions de chiffres), cette seule boucle représentait
~39,5 des ~50 minutes que durait un palier — estimation recoupée par les paliers
observés en production (15:29:16 → 16:19:55, soit 50 min 39 s).

Deux changements, le second facultatif : `isqrt` délègue au moteur arithmétique,
et GMP (via `gmpy2`) est utilisé s'il est présent, avec repli automatique sur les
entiers natifs. Python plafonne à Karatsuba (n^1,58), GMP passe en FFT (n^1,16).

Mesures sur l'état réel à 18,7 M de décimales :

| | entiers natifs | GMP | gain |
|---|---|---|---|
| évaluation d'un palier | 50 min 39 s | 7 s | **434×** |
| lecture du checkpoint (27 Mo) | 51,2 s | 1,5 s | 34× |
| `isqrt` sur 2 M de chiffres | 31,93 s / 40,6 Mo | 0,07 s / 9,1 Mo | 456× |

Correction vérifiée avant bascule : π identique au chiffre près entre les deux
moteurs à 1 000, 10 000, 50 000 et 200 000 décimales, et checkpoints
interchangeables dans les deux sens — un retour en arrière reste possible.
Commit `cf8a89b`.

### Le goulot se déplace : taille de palier portée à 100 000

Une fois le calcul à 7 secondes, un cycle de 82 s se décomposait ainsi : 7 s de
calcul, 70 s pour sauvegarder et envoyer le checkpoint de 27 Mo, 5 s pour le
backup local et `pi_complet.txt`. Le calcul ne pesait plus que 8,5 %.

`evaluate_pi` réévaluant π en entier à chaque palier, son coût ne dépend pas de
la taille de celui-ci : l'agrandir amortit évaluation et E/S. En sens inverse,
`add_terms` est une boucle Python dont le coût croît plus vite que linéairement.
D'où un optimum mesuré :

| palier | `add_terms` | `evaluate` | débit |
|---|---|---|---|
| 1 000 | 0,5 s | 6,9 s | 43 711 /h |
| 10 000 | 14,8 s | 7,0 s | 371 770 /h |
| 50 000 | 102,6 s | 7,9 s | 969 929 /h |
| **100 000** | 238,3 s | 6,9 s | **1 124 158 /h** |
| 250 000 | 1 011,1 s | 9,2 s | 821 678 /h |

Premier palier réel après bascule : `add_terms` 309 s, évaluation 8 s, soit
~919 000 décimales/heure une fois les E/S comptées — un peu sous la mesure de
laboratoire, le processeur étant partagé avec les autres calculateurs de la
machine. À comparer aux ~1 335 décimales/heure d'avant : **facteur ~690**.
Commit `ff0e860`.

Piste restante : `add_terms` est désormais le goulot (309 s sur ~392). Le binary
splitting, algorithme habituel pour Chudnovsky, le ramènerait en O(M(n) log n),
mais c'est une réécriture du moteur.

### Les arrêts mémoire ne venaient pas de π seul

En surveillant la bascule, deux tâches de fond ont été tuées faute de mémoire.
Le relevé des processus a montré que le calculateur π n'occupait alors que
128 Mo : la mémoire était prise par les autres projets de la machine —
`fibo.tmktools.com` (1,32 Go), le calculateur de `phi.tmktools.com` (1,16 Go) et
cinq sessions Claude (~1,75 Go cumulés). Trois calculateurs et plusieurs sessions
se partagent 14 Go sans arbitrage.

Le passage à GMP a fait tomber le pic de π de 9,5 Go à 1 ou 2 Go, ce qui éloigne
nettement le risque. Mais la cause de fond demeure : si les autres projets
grossissent, les arrêts reviendront et frapperont l'un des trois, pas
nécessairement celui qui dérape. Piste proposée, non appliquée : donner à chaque
calculateur un plafond `MemoryMax` / `MemoryHigh` dans son unité systemd, pour
que le noyau freine le service fautif au lieu d'en tuer un au hasard.

### Le filet a été éprouvé pour de vrai

Le contrôle de disponibilité n'avait jamais été mis à l'épreuve — c'est
exactement ce qui a manqué ce matin. Test mené après son installation, en
reproduisant l'incident constaté (application absente de PM2, et non simple
processus tué, que PM2 aurait relancé lui-même) :

    16 h 45 51  npx pm2 delete pi-tmktools  → port 3001 muet, site en 503
    16 h 50 02  le cron détecte le port muet
    16 h 50 12  relance effectuée, HTTP 200

251 secondes au total, dans la fenêtre annoncée de cinq minutes. `linkfree`, qui
partage le même démon PM2, n'a pas été touché. Le journal `logs/keepalive.log`
porte enfin sa première écriture, ce qui lève l'ambiguïté qui a causé la panne.

### Purge des checkpoints historisés

Les copies historisées du checkpoint s'accumulaient : neuf fichiers de 27 Mo, soit
246 Mo des 323 Mo de `data/`, pour un contenu presque identique (les termes de la
série, qui ne varient que de mille décimales d'un fichier au suivant).

`REMOTE_CHECKPOINT_HISTORY` passe de 10 à 1. Le motif de rotation est aussi
restreint à `pi_checkpoint_[0-9]*.json` : `pi_checkpoint_*.json` englobait
`pi_checkpoint_restore.json`, si bien qu'avec un historique de 1 le point de
reprise protégé aurait été supprimé à chaque rotation et seulement recréé en cas
de progression — donc perdu lors d'une régression, le seul cas où il sert. Le
défaut préexistait, mais ne se déclenchait qu'au-delà de dix copies.

Purge de l'existant faite avec la commande exacte du nouveau code, ce qui la
valide : `data/` ramené de 323 Mo à 114 Mo, les trois points de reprise intacts
(principal, protégé, dernier historisé). Commit `c0df2c3`.

**Le calculateur en cours a l'ancien code en mémoire** : le réglage ne prendra
effet qu'à son prochain redémarrage. D'ici là, les historiques remonteront à dix.

### Point de vigilance : le calculateur local est tué par manque de mémoire

Constaté en auditant le service : `pi-calculate.service` a été tué deux fois le
12 septembre (00 h 24 et 14 h 41) par le **OOM killer** du noyau, avec des pics de
**9,5 Go puis 6,4 Go**. La machine a 14 Go de mémoire, dont 12 déjà utilisés, et
ses 4 Go de swap sont saturés. L'évaluation d'un palier à 18,7 M décimales demande
donc plus que ce qui reste disponible.

Conséquence immédiate limitée : le service redémarre seul au bout d'une minute et
repart du dernier checkpoint. Chaque incident coûte le palier en cours et environ
une minute de rechargement, rien de plus.

Mais le besoin croît avec le nombre de décimales : ces arrêts vont se rapprocher.
Pistes, à arbitrer : agrandir le swap, libérer de la mémoire sur le poste, ou
plafonner la précision par lancement. À décider avant que la progression ne
s'arrête d'elle-même.

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
