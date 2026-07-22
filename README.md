# 🥧 Calcul de π — Algorithme de Chudnovsky (BigInt)

Ce projet calcule les décimales de π avec l'algorithme de **Chudnovsky** en utilisant l'arithmétique entière native de Python (BigInt). Il est conçu pour tourner sur le **poste Windows actuel** (`C:\Users\Admin\Documents\Developpement\PIpi4`) en tâche de fond, de manière **infinie**, avec sauvegarde, reprise après interruption et **upload automatique vers un serveur de production**.

> ℹ️ Ce projet fonctionnait auparavant sur un Raspberry Pi 4. Il est maintenant exécuté directement sur le poste local.

## ✨ Caractéristiques principales

- **♾️ Calcul non borné (infini)** : le programme continue d'ajouter des décimales jusqu'à ce qu'il soit arrêté manuellement.
- **🔄 Reprise automatique** : l'état du calcul est sauvegardé dans `pi_checkpoint.json`. En cas d'arrêt (`Ctrl+C`, fermeture, redémarrage…), le programme reprend exactement là où il s'était arrêté.
- **💾 Sauvegarde automatique** : toutes les **1000 décimales**, le fichier `pi_complet.txt` est mis à jour.
- **☁️ Upload automatique vers la production** : après chaque palier, `pi_complet.txt` est uploadé par SCP vers `vote1550@109.234.165.174:/home/vote1550/pi.tmktools.com/data/pi_complet.txt`, avec **vérification du nombre de décimales** du fichier distant.
- **🛡️ Protection anti-régression** : un fichier local plus petit ne peut jamais écraser un fichier distant plus avancé. Le calculateur télécharge aussi un checkpoint distant plus récent s'il existe.
- **🔒 Verrouillage** : un fichier `pi_calculate.lock` empêche le lancement de plusieurs instances simultanées.
- **📝 Logs clairs avec emojis** : le fichier `pi_calculate.log` utilise des emojis pour rendre le suivi visuel et rapide.
- **👁️ Aperçu en temps réel** : le fichier `pi_progress.txt` montre les 50 premiers chiffres calculés.

## 📁 Fichiers du projet

| Fichier | Description |
|---------|-------------|
| `calculate_pi.py` | Programme principal de calcul de π |
| `run_local.ps1` | Lanceur PowerShell pour Windows |
| `run_local.bat` | Raccourci batch vers `run_local.ps1` |
| `stop_local.ps1` | Arrêt propre du calculateur local |
| `README.md` | Documentation complète |
| `pi_complet.txt` | Fichier principal avec toutes les décimales calculées |
| `pi_progress.txt` | Aperçu rapide des 50 premiers chiffres |
| `pi_checkpoint.json` | État du calcul pour la reprise |
| `pi_calculate.log` | Journal d'exécution complet avec emojis |
| `../picalc/data/pi_20000000.txt` | Snapshot protecteur de référence utilisé comme source de vérité |
| `pi_calculate.pid` | PID du processus en arrière-plan |
| `pi_calculate.lock` | Fichier de verrouillage anti-double-instance |

## 🔧 Prérequis

- **Windows 10/11** avec Python 3 installé (`python3` ou `py`).
- Une **clé SSH autorisée** depuis ce poste vers le serveur de production, pour permettre l'upload automatique sans mot de passe.

### Vérifier la connexion SSH vers la production

```powershell
ssh -o BatchMode=yes vote1550@109.234.165.174 echo "Connexion OK"
```

Si cette commande affiche `Connexion OK`, l'upload automatique fonctionnera.

## 🚀 Lancer le calcul sur le poste local

### Mode infini (par défaut)

Ouvrez un terminal PowerShell dans le dossier `PIpi4` :

```powershell
.\run_local.ps1
```

Ou via le raccourci batch :

```batch
run_local.bat
```

Le programme calcule sans fin, palier par palier de 1000 décimales.

### Mode fini

```powershell
.\run_local.ps1 -Digits 50000
```

### Arrêter proprement

```powershell
.\stop_local.ps1
```

Ou directement avec le PID affiché au lancement :

```powershell
Stop-Process -Id <PID>
```

## 📊 Suivi du calcul

```powershell
# Log complet
Get-Content pi_calculate.log -Tail 30 -Wait

# Aperçu des 50 premiers chiffres
Get-Content pi_progress.txt

# Fichier complet en cours
Get-Content pi_complet.txt -Head 10
```

## 🌐 Site web

Le site web affiche les décimales en temps réel :

🔗 https://pi.tmktools.com

Pour synchroniser manuellement le fichier π local vers le site :

```bash
cd ..\picalc
.\deploy-with-data.sh "mise à jour des décimales"
```

## 🛠️ Architecture technique

Le programme utilise une version **incrémentale** de la formule de Chudnovsky :

```
π = C * sqrt(10005) / S
```

avec `S = Σ (-1)^k * (6k)! * (13591409 + 545140134k) / ((3k)! * (k!)^3 * (-640320^3)^k)`.

La somme partielle `S` est maintenue sous la forme `S_n = P_n / (-640320^3)^n`, ce qui permet d'ajouter des termes par blocs sans recalculer toute la série depuis le début.

## 🛡️ Protection contre les régressions

- **Avant upload** : le script lit l'en-tête du fichier π distant. S'il est plus avancé, l'upload est ignoré.
- **Au démarrage** : si un checkpoint distant est plus avancé que le local, le local est automatiquement upgradé.
- **Snapshot de référence** : le fichier `../picalc/data/pi_20000000.txt` est utilisé comme source de vérité. Si le calculateur redémarre sans checkpoint valide, il reconstruit l'état depuis ce snapshot protecteur.
- **Checkpoint de restauration** : `pi_checkpoint_restore.json` est conservé côté serveur comme filet de sécurité maximal.

## 📝 Format de l'en-tête

```text
# Pi Complet made with ♥ by PI RasberryPi4
# Dernière mise a jour : 2026-07-18T05:22:37.876+02:00
# Nombre total de décimales : 13,817,174
# Algorithme : Chudnovsky (BigInt)
#
3.14159265358979323846264338327950288419716939937510...
```

## 📝 Licence

Projet personnel — fait avec ♥.
