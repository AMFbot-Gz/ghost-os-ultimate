# Ghost OS — Tâches autonomes périodiques

Ces tâches sont exécutées automatiquement par la conscience universelle (boucle 30s).
Format : `## [intervalle] Titre` suivi d'instructions en langage naturel.

## [30s] Santé des couches
Vérifie que les 7 couches Python répondent. Log les couches DOWN dans le bus d'événements sous `layer.health.check`.

## [5min] Nettoyage mémoire épisodique
Si la mémoire épisodique dépasse 80% de capacité, compresser les anciens épisodes en gardant ceux avec success:false.

## [30min] Rapport système
Prendre un instantané CPU/RAM/Disque et l'émettre sur le bus sous `system.snapshot`.

## [1h] Auto-update registry skills
Recharger skills/registry.json depuis le disque pour détecter les nouveaux skills installés.
