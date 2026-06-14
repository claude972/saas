# MCP Gateway (scaffold)

Passerelle entre le backend et les **outils externes exposés via MCP**
(Model Context Protocol). **Non implémentée** pour l'instant : ce dossier ne
contient que des squelettes propres, sans logique réelle.

## Chaîne d'appel (règle)

```
OpenClaw  ->  Backend (FastAPI)  ->  Agent / Skill  ->  MCP Gateway  ->  Outil externe
```

- **OpenClaw** envoie une commande. Il n'écrit jamais en direct, n'appelle jamais un outil externe.
- **Le backend** reste l'autorité : il classe l'intention, choisit l'agent, journalise, applique le risk engine.
- **Un agent / skill**, pendant son exécution, peut avoir besoin d'un outil externe (ex. service tiers).
- Il passe alors par la **MCP Gateway**, jamais en direct.
- **La gateway** détient les connexions MCP (`MCPClient`), résolues via le `MCPRegistry`,
  et exécute l'appel vers l'**outil externe**.

Toute action sensible déclenchée par un outil externe reste soumise aux mêmes règles :
risque évalué, validation humaine si nécessaire, journalisation complète.

## Contenu (placeholders)

- `client.py` — `MCPClient` : connexion à un serveur MCP (non implémenté).
- `registry.py` — `MCPRegistry` : inventaire des clients MCP disponibles (non implémenté).
- `__init__.py` — marque le package.

## À faire plus tard

- Implémenter la connexion réelle (transport, handshake, listing des outils).
- Brancher le registre sur la configuration (serveurs MCP autorisés).
- Exposer un point d'entrée que les agents/skills appellent (avec passage par le risk engine et l'audit logger).
