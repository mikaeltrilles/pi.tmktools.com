# CLAUDE.md — instructions permanentes pour pi.tmktools.com

Ce fichier est lu automatiquement par Claude Code à chaque session. Il consigne les
règles de travail décidées avec Mika et le contexte indispensable du projet.
Le README.md décrit le fonctionnement technique ; ce fichier décrit **comment travailler**.

## Langue et forme

- Toujours répondre, commenter et documenter en **français**, avec les accents.
- Messages de commit en français, **détaillés** : un titre `type(scope): résumé`
  (feat, fix, refactor, chore, docs…) suivi d'un corps qui explique le pourquoi,
  liste les fichiers touchés et mentionne les vérifications effectuées.

## Cycle de livraison (règle par défaut, sauf demande contraire)

Pour toute modification demandée : **1) coder, 2) vérifier, 3) commit détaillé,
4) push sur GitHub, 5) déployer en production, 6) vérifier la production.**

- Déploiement : `scripts/deploy.sh "message"` depuis la racine du dépôt. Le script
  commite ce qui reste, pousse sur `origin main`, met à jour la constante `VERSION`
  de `public/sw.js` à partir du contenu de `public/`, synchronise par rsync vers
  `vote1550@109.234.165.174:/home/vote1550/pi.tmktools.com`, lance `npm install`
  puis recharge PM2 (`pi-tmktools`, port 3001).
- `scripts/deploy-with-data.sh` uniquement pour pousser aussi `pi_complet.txt`
  (rarement utile : le calculateur l'uploade tout seul à chaque palier).
- Vérification de production après déploiement : `scripts/remote-status.sh`,
  puis contrôle HTTP des ressources modifiées et, pour l'interface, un passage
  Playwright (voir « Tests »).

## Structure du dépôt (ne pas la défaire)

- Racine = site Node.js/Express (`server.js`, `public/`, `data/`, `ecosystem.config.js`, `.htaccess`).
- `calculator/` = calculateur Python (Chudnovsky, mode infini). Ses fichiers de
  travail (`pi_complet.txt`, `pi_checkpoint.json`, `pi_calculate.log`…) ne sont
  **jamais** versionnés ni déplacés. Le service systemd utilisateur
  `pi-calculate.service` a pour WorkingDirectory ce dossier.
- `scripts/` = déploiement, synchronisation, surveillance ; `scripts/legacy/` = anciens
  scripts Raspberry conservés pour mémoire. `docs/` = mémo des commandes et crontab
  de référence du serveur.
- Les anciens dépôts `PIpi4` et `picalc` ont été fusionnés ici le 5 septembre 2026
  (historique git conservé). Ne plus y faire référence.

## Interface : homogénéité avec phi.tmktools.com

- Le frontend partage le système de design de `../phi.tmktools.com`
  (`src/styles/*.css` là-bas, `public/styles.css` ici) : mêmes jetons, polices
  auto-hébergées, composants, structure de page (en-tête, hero avec symbole et
  formule, cartes, pied de page croisé). **Seul l'accent change** : cyan pour π,
  doré pour φ. Toute évolution visuelle doit rester cohérente entre les deux sites ;
  en cas de doute, s'aligner sur phi.
- Aucune ressource externe (CDN, Google Fonts, Bootstrap) : tout est servi par le site.
- PWA : `public/manifest.webmanifest`, `public/sw.js` (écrit à la main, sans build),
  bouton « Installer l'application » et bandeau de mise à jour identiques à phi.
  Le flux SSE, l'API et les fichiers π ne doivent jamais être mis en cache par le
  service worker. Icônes régénérées par `npm run icons` (sharp ; en local, un lien
  `node_modules/sharp -> ../phi.tmktools.com/node_modules/sharp` suffit).
- Les pages doivent tenir sans défilement horizontal dès 320 px.

## Tests

- Interface : captures Playwright (Chromium de `../phi.tmktools.com/node_modules`,
  binaire dans `~/.cache/ms-playwright`) en bureau et mobile, thèmes sombre et clair,
  avec contrôle des erreurs console et de `scrollWidth <= clientWidth`.
- **Contre la production, toujours forcer un `userAgent` de navigateur ordinaire.**
  L'agent par défaut de Playwright contient « HeadlessChrome », qu'o2switch
  identifie comme un robot : les ressources reviennent alors en « 429 Too Many
  Requests », la page s'affiche sans css ni js et paraît « Hors ligne » alors que
  le site est parfaitement sain. Diagnostic fait le 12 septembre 2026 ; sans cette
  précaution, tout contrôle d'interface conclut à tort à une panne.
- Si la version de Playwright ne correspond plus au Chromium téléchargé, pointer
  `executablePath` sur le binaire présent dans `~/.cache/ms-playwright` plutôt que
  de relancer `npx playwright install`.
- Serveur : `PORT=3199 node server.js` pour un test local sans toucher au port 3001.
- Calculateur : `python3 -m py_compile calculator/calculate_pi.py` et
  `python3 calculator/tests/test_chud_incremental.py`.

## Calculateur : précautions

- Ne jamais lancer `calculate_pi.py` à la main tant que `pi-calculate.service` est
  actif (`run_background.sh` le refuse). Arrêt propre : `systemctl --user stop
  pi-calculate.service` (jusqu'à 40 min : le palier en cours se termine d'abord).
- Un arrêt brutal ne perd que le palier en cours ; le checkpoint précédent reste valide.
- Snapshot : un seul fichier `data/pi_N.txt`, celui du dernier palier atteint (un
  palier par million) ; les précédents sont supprimés automatiquement par le serveur.
  Ne pas réintroduire de liste de paliers téléchargeables (décision du 2026-09-06).

## Serveur de production (o2switch, cPanel)

- SSH : `ssh -F /dev/null -o BatchMode=yes vote1550@109.234.165.174`
  (`-F /dev/null` contourne une configuration SSH système invalide sur le poste).
- Un 503 signifie presque toujours que PM2 est mort : `scripts/remote-status.sh`
  puis `npx pm2 startOrRestart ecosystem.config.js && npx pm2 save` sur le serveur.
  Le cron `scripts/remote-keepalive.sh` (toutes les 5 min) automatise cette relance.
- **Crontab : jamais `( crontab -l ; echo … ) | crontab -`** sur ce serveur :
  `/usr/bin/crontab` est un wrapper CageFS et cette forme efface le crontab existant.
  Toujours passer par un fichier (`crontab -l > f ; … ; crontab f`) ou par
  `scripts/install-remote-keepalive.sh`. Le contenu attendu est dans
  `docs/crontab-serveur.txt`. Ne jamais lancer `crontab -r` dans une session SSH.
- En mode automatique, Claude ne peut pas modifier un crontab (local ou distant) :
  fournir la commande exacte à lancer dans un terminal ; le préfixe `!` de Claude Code
  ne fonctionne pas dans les sessions à distance.

## Autres projets liés

- `../phi.tmktools.com` : nombre d'or, application statique Vite + PWA, même hébergement
  (`/home/vote1550/phi.tmktools.com`), déploiement par `scripts/deploy.sh` là-bas.
