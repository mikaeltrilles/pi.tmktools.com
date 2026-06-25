# 🥧 Calcul de π sur Raspberry Pi 4 — Algorithme de Chudnovsky (BigInt)

Ce projet calcule les décimales de π avec l'algorithme de **Chudnovsky** en utilisant l'arithmétique entière native de Python (BigInt). Il est conçu pour tourner sur un **Raspberry Pi 4** en tâche de fond, de manière **infinie**, avec sauvegarde, reprise après interruption et **upload automatique vers un serveur de production**.

## ✨ Caractéristiques principales

- **♾️ Calcul non borné (infini)** : le programme continue d'ajouter des décimales jusqu'à ce qu'il soit arrêté manuellement.
- **🔄 Reprise automatique** : l'état du calcul est sauvegardé dans `pi_checkpoint.json`. En cas d'arrêt (`Ctrl+C`, `kill`, coupure de courant…), le programme reprend exactement là où il s'était arrêté.
- **💾 Sauvegarde automatique** : toutes les **1000 décimales**, le fichier `pi_complet.txt` est copié dans `/home/mika/Documents`.
- **🗑️ Rotation des backups** : seuls les **3 derniers backups** sont conservés dans `/home/mika/Documents`.
- **☁️ Upload automatique vers la production** : après chaque palier, `pi_complet.txt` est uploadé par SCP vers `vote1550@109.234.165.174:/home/vote1550/pi.tmktools.com/data/pi_complet.txt`, avec **vérification de la taille** du fichier distant.
- **🔒 Verrouillage** : un fichier `pi_calculate.lock` empêche le lancement de plusieurs instances simultanées.
- **📝 Logs clairs avec emojis** : le fichier `pi_calculate.log` utilise des emojis pour rendre le suivi visuel et rapide.
- **👁️ Aperçu en temps réel** : le fichier `pi_progress.txt` montre les 50 premiers chiffres calculés.

## 📁 Fichiers du projet

| Fichier | Description |
|---------|-------------|
| `calculate_pi.py` | Programme principal de calcul de π |
| `run_background.sh` | Script de lancement en tâche de fond |
| `README.md` | Documentation complète |
| `pi_complet.txt` | Fichier principal avec toutes les décimales calculées |
| `pi_progress.txt` | Aperçu rapide des 50 premiers chiffres |
| `pi_checkpoint.json` | État du calcul pour la reprise |
| `pi_calculate.log` | Journal d'exécution complet avec emojis |
| `pi_calculate.pid` | PID du processus en arrière-plan |
| `pi_calculate.lock` | Fichier de verrouillage anti-double-instance |

## 🔧 Prérequis

- Un **Raspberry Pi 4** avec Python 3 installé.
- Une **clé SSH autorisée** depuis le Raspberry Pi vers le serveur de production, pour permettre l'upload automatique sans mot de passe.

### Vérifier la connexion SSH vers la production

Depuis le Raspberry Pi :

```bash
ssh -o BatchMode=yes vote1550@109.234.165.174 echo "Connexion OK"
```

Si cette commande affiche `Connexion OK`, l'upload automatique fonctionnera. Sinon, configurez une clé SSH :

```bash
ssh-keygen -t ed25519 -C "pi@raspberry"
ssh-copy-id vote1550@109.234.165.174
```

## 🚀 Déploiement rapide

1. **Transférer les fichiers** sur le Raspberry Pi, par exemple dans `/home/mika/Public/PIpi4/` :

   ```bash
   scp calculate_pi.py run_background.sh README.md mika@192.168.1.174:/home/mika/Public/PIpi4/
   ```

2. **Se connecter au Raspberry Pi** et rendre le script exécutable :

   ```bash
   ssh mika@192.168.1.174
   cd /home/mika/Public/PIpi4
   chmod +x run_background.sh
   ```

3. **Lancer le calcul en arrière-plan** :

   ```bash
   ./run_background.sh
   ```

   Par défaut, le programme démarre en **mode infini** et reprend depuis le checkpoint s'il en existe un.

   ⚠️ **Important** : `run_background.sh` garantit un seul processus actif à la fois. Il arrête d'abord proprement (puis de force si nécessaire) tout ancien processus `calculate_pi.py` avant de démarrer le nouveau.

## 🎮 Modes de fonctionnement

### ♾️ Mode infini (par défaut)

```bash
./run_background.sh
# ou directement
python3 calculate_pi.py
```

Le programme calcule sans fin, palier par palier de 1000 décimales. À chaque palier :
1. Il évalue π.
2. Il écrit `pi_complet.txt`.
3. Il sauvegarde le checkpoint.
4. Il crée un backup local dans `/home/mika/Documents`.
5. Il supprime les vieux backups (rotation à 3 fichiers).
6. Il upload `pi_complet.txt` sur le serveur de production.
7. Il vérifie la taille du fichier distant.

### 📏 Mode fini

Pour calculer exactement un nombre de décimales puis s'arrêter :

```bash
./run_background.sh --digits 50000
# ou
python3 calculate_pi.py --digits 50000
```

### 🗑️ Recommencer à zéro

Pour supprimer le checkpoint existant et recommencer le calcul depuis le début :

```bash
./run_background.sh --reset
# ou
python3 calculate_pi.py --reset
```

### 🔄 Ne pas reprendre le checkpoint

Pour démarrer un nouveau calcul sans effacer l'ancien checkpoint :

```bash
python3 calculate_pi.py --no-resume
```

### 📦 Changer la taille du palier

Par défaut, un palier = 1000 décimales. Vous pouvez changer cela :

```bash
./run_background.sh --chunk 5000
```

⚠️ Attention : plus le palier est grand, plus l'upload vers la production sera lourd.

## 👀 Commandes de suivi

### Suivre le journal complet (emojis)

```bash
tail -f /home/mika/Public/PIpi4/pi_calculate.log
```

Exemple de sortie :

```text
[2026-06-25 02:07:07 UTC] 📦 PALIER #4 — Cible : 16882 decimales
[2026-06-25 02:07:07 UTC] 🔢 Ajout de 640 termes Chudnovsky...
[2026-06-25 02:07:07 UTC] 🚀 7936 decimales atteintes (n=560)
[2026-06-25 02:07:07 UTC] 🧮 Evaluation de π a 17012 decimales...
[2026-06-25 02:07:07 UTC] 📝 Ecriture de pi_complet.txt (34034 decimales)
[2026-06-25 02:07:07 UTC] 💾 Sauvegarde du checkpoint : pi_checkpoint.json
[2026-06-25 02:07:07 UTC] 💾 Backup local cree : pi_complet_backup_34034dec_20260625_020707.txt
[2026-06-25 02:07:07 UTC] 🗑️  Backup supprime (rotation) : pi_complet_backup_2268dec_20260625_020652.txt
[2026-06-25 02:07:07 UTC] ☁️  Envoi vers le serveur de production : vote1550@109.234.165.174:/home/vote1550/pi.tmktools.com/data/pi_complet.txt
[2026-06-25 02:07:10 UTC] ✅ Upload production reussi
[2026-06-25 02:07:11 UTC] 🔍 Verification production OK : 34206 octets
[2026-06-25 02:07:11 UTC] ✅ Backup + upload production termines pour 34034 decimales
[2026-06-25 02:07:11 UTC] 🎯 Palier #4 termine : 34034 decimales de π calculees
[2026-06-25 02:07:11 UTC] 🔮 Apercu : 3.14159265358979323846264338327950288419716939937510...
```

### Aperçu rapide des 50 premiers chiffres

```bash
tail -f /home/mika/Public/PIpi4/pi_progress.txt
```

### Voir le fichier π complet en cours d'écriture

```bash
tail -f /home/mika/Public/PIpi4/pi_complet.txt
```

### Vérifier le PID du processus

```bash
cat /home/mika/Public/PIpi4/pi_calculate.pid
```

### Vérifier que le processus tourne

```bash
ps aux | grep calculate_pi | grep -v grep
```

### Voir les backups locaux

```bash
ls -lt /home/mika/Documents/pi_complet_backup_*.txt
```

### Vérifier le fichier sur le serveur de production

```bash
ssh vote1550@109.234.165.174 "ls -la /home/vote1550/pi.tmktools.com/data/pi_complet.txt && head -5 /home/vote1550/pi.tmktools.com/data/pi_complet.txt"
```

## 🚀 Lancement contrôlé unique

Le script `run_background.sh` garantit qu'**un seul processus `calculate_pi.py`** tourne à la fois. Avant chaque démarrage, il effectue les opérations suivantes :

1. **Lecture du fichier `pi_calculate.pid`** : s'il existe et que le PID est actif, envoi d'un `SIGTERM` (arrêt propre).
2. **Attente de 5 secondes** pour laisser le processus s'arrêter naturellement.
3. **Si le processus est toujours actif** : envoi d'un `SIGKILL` (arrêt forcé).
4. **Vérification finale** : si un processus résiste encore, le script refuse de démarrer.
5. **Suppression du fichier de lock** `pi_calculate.lock` s'il traîne.
6. **Démarrage du nouveau processus** et enregistrement du nouveau PID.

### Exemple de sortie

```text
==============================================
 Lancement controle de calculate_pi.py
==============================================
[1/3] Arret de l'ancien processus calculate_pi.py...
      Processus trouve (PID=16828) -> envoi SIGTERM...
      Processus toujours actifs : 16828 -> SIGKILL...
      Aucun processus calculate_pi.py actif.
      Fichier de lock supprime.

[2/3] Demarrage du nouveau processus...
      Nouveau PID : 17341

[3/3] Verification du demarrage...
      Processus 17341 actif.

==============================================
 ✅ calculate_pi.py demarre avec succes
==============================================
```

### En cas de double lancement manuel

Si vous lancez `./run_background.sh` alors qu'un calcul tourne déjà, l'ancien processus est arrêté **avant** le démarrage du nouveau. Le nouveau processus reprend automatiquement depuis le checkpoint `pi_checkpoint.json`.

## 🛑 Arrêt propre

```bash
kill "$(cat /home/mika/Public/PIpi4/pi_calculate.pid)"
```

> 💡 Utilisez les guillemets autour de `$(cat ...)` pour éviter les erreurs si le PID est précédé d'options.

Le programme va :
1. Terminer le terme de Chudnovsky en cours.
2. Évaluer π avec les décimales déjà atteintes.
3. Mettre à jour `pi_complet.txt`.
4. Sauvegarder l'état dans `pi_checkpoint.json`.
5. Copier le fichier dans `/home/mika/Documents`.
6. Uploader le fichier `pi_complet.txt` sur le serveur de production.
7. Vérifier la taille du fichier distant.

## 🔄 Reprise après interruption

Il suffit de relancer le programme :

```bash
cd /home/mika/Public/PIpi4
./run_background.sh
```

Le programme détecte automatiquement `pi_checkpoint.json` et reprend exactement au terme `n` où il s'était arrêté.

## ☁️ Upload automatique vers la production

Après chaque palier de 1000 décimales, le fichier `pi_complet.txt` est automatiquement uploadé par SCP vers :

```text
vote1550@109.234.165.174:/home/vote1550/pi.tmktools.com/data/pi_complet.txt
```

Le programme effectue ensuite une **vérification** : il lit la taille du fichier distant et la compare à la taille locale. Si les tailles correspondent, il affiche :

```text
🔍 Verification production OK : XXXXX octets
```

### Pour changer la destination de production

Modifiez les constantes en début de fichier `calculate_pi.py` :

```python
REMOTE_USER = "vote1550"
REMOTE_HOST = "109.234.165.174"
REMOTE_PATH = "/home/vote1550/pi.tmktools.com/data/pi_complet.txt"
```

## 🗑️ Rotation des backups locaux

Seuls les **3 derniers backups** sont conservés dans `/home/mika/Documents`. Les noms suivent le format :

```text
pi_complet_backup_<DECIMALES>dec_<AAAAMMJJ>_<HHMMSS>.txt
```

Exemple :

```text
pi_complet_backup_34034dec_20260625_020707.txt
pi_complet_backup_15882dec_20260625_020702.txt
pi_complet_backup_6806dec_20260625_020657.txt
```

## 🔒 Verrouillage anti-double-instance

Le programme crée un fichier `pi_calculate.lock` contenant son PID. Si vous tentez de lancer une deuxième instance, elle refuse de démarrer avec ce message :

```text
🔒 Une autre instance de calculate_pi.py est deja en cours.
   Utilisez : kill "$(cat pi_calculate.pid)"
```

Si le programme s'est crashé et que le lock persiste, supprimez-le manuellement :

```bash
rm /home/mika/Public/PIpi4/pi_calculate.lock
```

## 📊 Performance

- L'algorithme de Chudnovsky converge à environ **14.18 décimales par terme**.
- Le temps de calcul augmente avec le nombre de décimales, car les entiers deviennent très grands.
- Quelques ordres de grandeur indicatifs sur Raspberry Pi 4 :
  - 10 000 décimales : quelques secondes
  - 100 000 décimales : quelques minutes
  - 1 000 000 décimales : plusieurs heures
  - Au-delà : considérablement plus lent et gourmand en mémoire/disque

## 🖥️ Lancer au démarrage du Raspberry Pi (optionnel)

Pour démarrer automatiquement le calcul au boot, utilisez un service systemd. Créez le fichier `/etc/systemd/system/picalc.service` :

```ini
[Unit]
Description=Calcul de Pi par Chudnovsky
After=network.target

[Service]
Type=simple
User=mika
WorkingDirectory=/home/mika/Public/PIpi4
ExecStart=/usr/bin/python3 /home/mika/Public/PIpi4/calculate_pi.py
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

Puis activez-le :

```bash
sudo systemctl daemon-reload
sudo systemctl enable picalc.service
sudo systemctl start picalc.service
```

## 🛠️ Dépannage

### Le programme ne démarre pas

Vérifiez qu'une autre instance ne tourne pas :

```bash
ps aux | grep calculate_pi | grep -v grep
```

Supprimez le lock si nécessaire :

```bash
rm /home/mika/Public/PIpi4/pi_calculate.lock
```

### L'upload vers la production échoue

1. Vérifiez la connexion SSH sans mot de passe :

   ```bash
   ssh -o BatchMode=yes vote1550@109.234.165.174 echo OK
   ```

2. Vérifiez le log d'erreur :

   ```bash
   tail -20 /home/mika/Public/PIpi4/pi_calculate.log
   ```

3. Assurez-vous que le dossier distant existe et est accessible en écriture :

   ```bash
   ssh vote1550@109.234.165.174 "mkdir -p /home/vote1550/pi.tmktools.com/data && ls -la /home/vote1550/pi.tmktools.com/data"
   ```

### Le fichier π contient des valeurs incorrectes

Si les premières décimales ne commencent pas par :

```text
3.14159265358979323846264338327950288419716939937510...
```

arrêtez le programme et relancez avec `--reset` :

```bash
cd /home/mika/Public/PIpi4
kill "$(cat pi_calculate.pid)"
./run_background.sh --reset
```

## 📖 Interprétation des logs d'un palier

Chaque palier produit un bloc de logs similaire à celui-ci :

```text
📦 PALIER #2 — Cible : 162538 decimales
[2026-06-25 13:24:26 CEST] 🔢 Ajout de 13 termes Chudnovsky...
[2026-06-25 13:24:26 CEST] 🚀   162488 decimales atteintes (n=11458)
[2026-06-25 13:24:26 CEST] 🧮 Evaluation de π a 162672 decimales...
[2026-06-25 13:24:39 CEST] 📝 Ecriture de pi_complet.txt (162672 decimales)
[2026-06-25 13:24:39 CEST] 💾 Sauvegarde du checkpoint : pi_checkpoint.json
[2026-06-25 13:24:40 CEST] 💾 Backup local cree : pi_complet_backup_162672dec_20260625_112440.txt
[2026-06-25 13:24:40 CEST] 🗑️  Backup supprime (rotation) : pi_complet_backup_162119dec_20260625_111406.txt
[2026-06-25 13:24:40 CEST] ☁️  Envoi vers le serveur de production : vote1550@109.234.165.174:/home/vote1550/pi.tmktools.com/data/pi_complet.txt
[2026-06-25 13:24:41 CEST] ✅ Upload production reussi : vote1550@109.234.165.174:/home/vote1550/pi.tmktools.com/data/pi_complet.txt
[2026-06-25 13:24:42 CEST] 🔍 Verification production OK : 162850 octets
[2026-06-25 13:24:42 CEST] ✅ Backup + upload production termines pour 162672 decimales
[2026-06-25 13:24:42 CEST] 🎯 Palier #2 termine : 162672 decimales de π calculees
[2026-06-25 13:24:42 CEST] 🔮 Apercu : 3.14159265358979323846264338327950288419716939937510...
```

| Ligne | Signification |
|---|---|
| `📦 PALIER #2 — Cible : 162538 decimales` | Le programme travaille par paliers de ~1000 décimales. Après le palier #1, il avait environ 161 119 décimales validées. La cible du palier #2 est donc `161 119 + 1000 ≈ 162 538`. |
| `🔢 Ajout de 13 termes Chudnovsky...` | Le moteur ajoute 13 nouveaux termes à la somme infinie de Chudnovsky. Chaque terme apporte environ **14,18 décimales**, donc 13 termes suffisent pour dépasser la cible. |
| `🚀   162488 decimales atteintes (n=11458)` | Après ces 13 termes, le moteur estime qu'il a **162 488 décimales sûres**, avec un total de `n = 11 458` termes de la série sommés. C'est une estimation intermédiaire, pas le nombre final. |
| `🧮 Evaluation de π a 162672 decimales...` | Le programme convertit le résultat du calcul en une chaîne de chiffres. Il calcule avec une petite marge de sécurité, d'où `162 672` au lieu de `162 488` exactement. |
| `📝 Ecriture de pi_complet.txt (162672 decimales)` | Le fichier local `pi_complet.txt` est réécrit avec le nouvel en-tête et les 162 672 décimales. |
| `💾 Sauvegarde du checkpoint : pi_checkpoint.json` | L'état du moteur (`n`, `P`, `M`, `L`, `digits_done`) est sauvegardé pour permettre une reprise immédiate après une coupure. |
| `💾 Backup local cree : pi_complet_backup_162672dec_20260625_112440.txt` | Une copie datée est créée dans `/home/mika/Documents/`. Son nom contient le nombre de décimales et la date/heure au format UTC. |
| `🗑️  Backup supprime (rotation) : pi_complet_backup_162119dec_20260625_111406.txt` | Rotation automatique : seuls les 3 derniers backups sont conservés. L'ancien est supprimé. |
| `☁️  Envoi vers le serveur de production : ...` | Le fichier `pi_complet.txt` local est envoyé par SCP vers le serveur o2switch. |
| `✅ Upload production reussi : ...` | Le fichier a bien été déposé sur le serveur distant. |
| `🔍 Verification production OK : 162850 octets` | Le programme se reconnecte en SSH au serveur pour vérifier la taille du fichier distant : **162 850 octets**, ce qui correspond au fichier local. |
| `✅ Backup + upload production termines pour 162672 decimales` | Toutes les opérations de sauvegarde (locale + distante) sont terminées avec succès. |
| `🎯 Palier #2 termine : 162672 decimales de π calculees` | Bilan du palier : 162 672 décimales de π sont maintenant écrites, sauvegardées et uploadées. |
| `🔮 Apercu : 3.14159265358979323846264338327950288419716939937510...` | Affichage des 52 premiers chiffres de π pour confirmation visuelle rapide. |

### Pourquoi la cible n'est pas exactement un multiple de 1000 ?

La cible théorique est `digits_done + 1000`. En pratique, le moteur ajoute un nombre entier de termes Chudnovsky. Comme chaque terme apporte environ 14,18 décimales, le résultat final dépasse légèrement la cible. Le nombre réel de décimales écrites est donc un peu supérieur au palier de 1000 demandé.

### Pourquoi `n` augmente si peu entre deux paliers ?

Plus le calcul avance, plus chaque terme de Chudnovsky est précieux. Avec `n = 11 458`, 13 nouveaux termes suffisent pour gagner ~1000 décimales. Au début du calcul, il fallait plusieurs dizaines de termes pour atteindre le même gain.

## 🧮 Architecture technique

Le programme utilise une version **incrémentale** de la formule de Chudnovsky :

```
π = C * sqrt(10005) / S
```

avec `S = Σ (-1)^k * (6k)! * (13591409 + 545140134k) / ((3k)! * (k!)^3 * (-640320^3)^k)`.

La somme partielle `S` est maintenue sous la forme `S_n = P_n / (-640320^3)^n`, ce qui permet d'ajouter des termes par blocs sans recalculer toute la série depuis le début. Cela rend le calcul efficace et la reprise après interruption immédiate.

## 📜 Format de l'en-tête

Le fichier `pi_complet.txt` commence par :

```text
# Pi Complet made with ♥ by PI RasberryPi4
# Dernière mise a jour : 2026-06-25T02:07:07.996Z
# Nombre total de décimales : 34,034
# Algorithme : Chudnovsky (BigInt)
#
3.14159265358979323846264338327950288419716939937510...
```

## 📝 Licence

Projet personnel — fait avec ♥ par **PI RasberryPi4**.
