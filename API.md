# Documentation API Buildotheque

Cette API permet de gérer des "builds" (configurations) avec une authentification via Discord OAuth2. Elle est développée avec Hono et déployée sur Cloudflare Workers.

## Base URL
La base URL de l'API dépend de l'environnement de déploiement (généralement fournie via la configuration Cloudflare).

## Authentification

L'API utilise des jetons JWT pour l'authentification. Pour les routes protégées, vous devez inclure le jeton dans l'en-tête `Authorization`.

**En-tête requis :**
`Authorization: <votre_token_jwt>`

### Flux Discord OAuth2

1. **Redirection vers Discord** :  
   `GET /auth/discord?state=<facultatif>`  
   Redirige l'utilisateur vers la page d'autorisation de Discord.
2. **Callback** :  
   `GET /auth/discord/callback?code=<code>&state=<state>`  
   Gère le retour de Discord, crée un JWT et redirige vers le frontend avec le jeton en paramètre d'URL (`?token=...`).

### Vérification de session
`GET /auth/me` (Authentification requise)
Récupère les informations de l'utilisateur connecté.

**Réponse (200 OK) :**
```json
{
  "id": "hashed_discord_id",
  "username": "PseudoDiscord",
  "avatar": "avatar_hash"
}
```

---

## Builds

### Liste et Recherche
`GET /builds`  
Récupère une liste de builds selon plusieurs critères.

**Paramètres de requête (Query params) :**
- `text` (string, optionnel) : Recherche par nom ou description.
- `auteurId` (string, optionnel) : Filtre par identifiant d'auteur (ID Discord haché).
- `tags` (string, optionnel) : Liste de tags séparés par des virgules (ex: `pve,tank`).
- `limit` (number, défaut: 50, max: 200) : Nombre de résultats.
- `offset` (number, défaut: 0) : Pagination.
- `random` (boolean, défaut: true) : Si `false`, désactive le tri aléatoire (selon l'implémentation interne).

**Réponse (200 OK) :**
```json
{
  "builds": [ ... ],
  "total": 123,
  "limit": 50,
  "offset": 0
}
```

### Builds récents
`GET /builds/recent`  
Identique à `/builds` mais trié par date de création décroissante.

### Tops Builds (les plus aimés)
`GET /builds/top`  
Identique à `/builds` mais trié par nombre de "likes" décroissant.

### Récupérer un build par ID
`GET /builds/:id`

**Réponse (200 OK) :**
```json
{
  "id": "string",
  "nom": "string",
  "description": "string",
  "auteur": "string",
  "auteurId": "string",
  "tags": ["string"],
  "encoded": "string",
  "likes": 0,
  "timestamp": 123456789
}
```

---

## Actions (Authentification requise)

### Créer un build
`POST /builds`

**Corps de la requête (JSON) :**
- `nom` (string, requis, max 25 car.)
- `description` (string, requis, max 250 car.)
- `encoded` (string, requis, max 8000 car.) : La configuration encodée du build.
- `auteur` (string, optionnel, max 25 car.) : Nom d'affichage personnalisé.
- `tags` (array de strings, optionnel, max 5 tags de 25 car. chacun)

**Réponse (201 Created) :** Le build créé.

### Modifier un build
`PUT /builds/:id`  
Seul le propriétaire du build (même `auteurId`) peut le modifier.

**Corps de la requête (JSON) :** Champs optionnels parmi `nom`, `description`, `encoded`, `auteur`, `tags`.

**Réponse (200 OK) :** Le build mis à jour.

### Supprimer un build
`DELETE /builds/:id`  
Seul le propriétaire du build peut le supprimer.

**Réponse (200 OK) :** `{ "message": "Build supprimé avec succès" }`

### Liker / Unliker un build
`POST /builds/:id/like`  
Ajoute ou retire un "like" sur un build.

**Réponse (200 OK) :**
```json
{
  "likes": 10,
  "liked": true
}
```

---

## Santé de l'API
`GET /`  
Vérifie si l'API est fonctionnelle.

**Réponse (200 OK) :**
```json
{ "status": "ok", "name": "Buildotheque API" }
```

---

## Codes d'erreur
- `400 Bad Request` : Paramètres manquants ou invalides.
- `401 Unauthorized` : Authentification requise ou jeton invalide.
- `403 Forbidden` : Action non autorisée (ex: modification d'un build tiers).
- `404 Not Found` : Ressource ou route introuvable.
- `500 Internal Server Error` : Erreur serveur.
