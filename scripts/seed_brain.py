#!/usr/bin/env python3
"""
seed_brain.py — Pré-charge le cerveau Ghost OS avec des connaissances d'automatisation

Usage:
  python3 scripts/seed_brain.py                    # Mode offline
  python3 scripts/seed_brain.py --live             # Via Memory layer (:8006) + ChromaDB
  python3 scripts/seed_brain.py --category n8n     # Une seule catégorie
  python3 scripts/seed_brain.py --dry-run          # Affiche sans écrire
  python3 scripts/seed_brain.py --count            # Compte les entrées actuelles
  python3 scripts/seed_brain.py --list             # Liste les catégories

Catégories: n8n | macos | web | files | system | ghost_os | security | data
"""
import asyncio, argparse, json, sys
from datetime import datetime, timezone
from pathlib import Path

try:
    import httpx
    _HTTPX = True
except ImportError:
    _HTTPX = False

ROOT = Path(__file__).parent.parent
EPISODES_FILE   = ROOT / "agent/memory/episodes.jsonl"
HEURISTICS_FILE = ROOT / "agent/memory/heuristics.jsonl"
MEMORY_URL = "http://localhost:8006"

SEEDS = [
    {"mission": "Webhook n8n -> extraire données -> Telegram", "skills_used": ["http_fetch", "telegram_notify"], "learned": "n8n webhook = http_fetch GET /webhook/{id}. body.data -> telegram_notify.", "category": "n8n"},
    {"mission": "Lire CSV et poster chaque ligne sur API REST", "skills_used": ["read_file", "http_fetch"], "learned": "read_file -> split('\\n') -> http_fetch POST par ligne. Timeout 5s par requête.", "category": "n8n"},
    {"mission": "Execute Command n8n -> sauvegarder résultat", "skills_used": ["run_command", "write_file_safe"], "learned": "run_command timeout=30000, capturer stderr. write_file_safe atomic.", "category": "n8n"},
    {"mission": "Scraper page web -> extraire titres", "skills_used": ["http_fetch", "write_file_safe"], "learned": "http_fetch GET + regex h1-h6. Pas puppeteer pour extraction simple.", "category": "n8n"},
    {"mission": "Google Sheets API écrire dans une feuille", "skills_used": ["http_fetch"], "learned": "POST /spreadsheets/{id}/values/{range}:append. Authorization: Bearer {token}. valueInputOption=RAW.", "category": "n8n"},
    {"mission": "Email SendGrid avec pièce jointe", "skills_used": ["read_file", "http_fetch"], "learned": "POST /v3/mail/send. Fichier en base64 dans attachments[]. Content-Type: application/json.", "category": "n8n"},
    {"mission": "Surveiller dossier nouvelles arrivées", "skills_used": ["run_command", "telegram_notify"], "learned": "Polling 5s: run_command ls -la. Comparer snapshot précédent.", "category": "n8n"},
    {"mission": "Transformer JSON en CSV", "skills_used": ["write_file_safe"], "learned": "Object.keys(data[0]).join(',') = headers. data.map(r => Object.values(r).join(',')).join('\\n') = body.", "category": "n8n"},
    {"mission": "API avec retry backoff exponentiel", "skills_used": ["http_fetch"], "learned": "for i in 0..3: try fetch except delay(1000*2^i). Max 3 retries.", "category": "n8n"},
    {"mission": "Slack notification bloc formaté", "skills_used": ["http_fetch"], "learned": "POST /api/chat.postMessage. blocks=[{type:'section',text:{type:'mrkdwn',text:'...'}}]. Bearer token.", "category": "n8n"},
    {"mission": "n8n Function node -> skill Ghost OS", "skills_used": [], "learned": "n8n Function = code JS arbitraire. Ghost OS: export async function run(). Même logique.", "category": "n8n"},
    {"mission": "n8n IF node -> conditionnel Ghost OS", "skills_used": [], "learned": "n8n IF = true/false. Ghost OS: if/else dans skill.js ou deux skills séquentiels.", "category": "n8n"},
    {"mission": "n8n Merge -> combiner résultats parallèles", "skills_used": [], "learned": "n8n Merge = branches multiples. Ghost OS: Promise.all([s1, s2]) puis Object.assign().", "category": "n8n"},
    {"mission": "Importer workflow n8n JSON dans Ghost OS", "skills_used": [], "learned": "python3 scripts/import_n8n.py workflow.json --dry-run preview. --install pour déployer.", "category": "n8n"},
    {"mission": "Ouvrir Safari et naviguer URL", "skills_used": ["open_app", "goto_url"], "learned": "open_app Safari -> attendre 2s -> goto_url. Sans délai Safari pas prêt.", "category": "macos"},
    {"mission": "Screenshot écran entier macOS", "skills_used": ["take_screenshot"], "learned": "take_screenshot path=/tmp/ghost_screenshot.png. < 1s. Vérifier existsSync après.", "category": "macos"},
    {"mission": "Ouvrir Terminal et exécuter commande", "skills_used": ["open_app", "type_text", "press_key"], "learned": "open_app Terminal -> type_text cmd -> press_key Return. FAILSAFE: pas coin haut-gauche.", "category": "macos"},
    {"mission": "Fermer application macOS", "skills_used": ["open_app"], "learned": "open_app action='quit'. osascript: tell app X to quit. Attendre 1s.", "category": "macos"},
    {"mission": "Lister applications ouvertes macOS", "skills_used": ["run_command"], "learned": "osascript -e 'tell app System Events to get name of every process'. Plus fiable que ps aux.", "category": "macos"},
    {"mission": "Copier texte presse-papier macOS", "skills_used": ["run_command"], "learned": "echo 'texte' | pbcopy. Lire: pbpaste. pbcopy < file.txt pour fichier.", "category": "macos"},
    {"mission": "Déplacer fichiers Desktop organisés", "skills_used": ["run_command"], "learned": "mv ~/Desktop/*.pdf ~/Documents/PDFs/. mkdir -p avant si dossier absent.", "category": "macos"},
    {"mission": "CPU mémoire système macOS", "skills_used": ["get_agent_status"], "learned": "get_agent_status retourne CPU/RAM. Alt: top -l 1 -n 0 | grep CPU|PhysMem.", "category": "macos"},
    {"mission": "Ouvrir PDF dans Preview", "skills_used": ["run_command"], "learned": "run_command 'open -a Preview /path/file.pdf'. Plus rapide que open_app + navigation.", "category": "macos"},
    {"mission": "Notification macOS depuis script", "skills_used": ["run_command"], "learned": "osascript -e 'display notification \"msg\" with title \"Ghost OS\"'.", "category": "macos"},
    {"mission": "Télécharger fichier HTTPS", "skills_used": ["http_fetch", "write_file_safe"], "learned": "http_fetch GET + write_file_safe. >50MB: streaming. Vérifier Content-Length avant.", "category": "web"},
    {"mission": "OAuth2 access token", "skills_used": ["http_fetch"], "learned": "POST /oauth/token grant_type=client_credentials. Stocker token + expiry. Refresh si < 60s.", "category": "web"},
    {"mission": "Paginer API REST tous les résultats", "skills_used": ["http_fetch"], "learned": "while page <= max: fetch ?page=X&limit=100. Stop si results.length < 100.", "category": "web"},
    {"mission": "Vérifier site UP alerter DOWN", "skills_used": ["http_fetch", "telegram_notify"], "learned": "http_fetch GET timeout 5s. Si status != 200: telegram_notify. Retry 3 fois.", "category": "web"},
    {"mission": "POST JSON API Bearer auth", "skills_used": ["http_fetch"], "learned": "fetch(url, {method:'POST', headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'}, body:JSON.stringify(data)})", "category": "web"},
    {"mission": "Lire JSON modifier clé sauvegarder", "skills_used": ["read_file", "write_file_safe"], "learned": "read_file -> JSON.parse -> modifier -> JSON.stringify(data,null,2) -> write_file_safe atomic.", "category": "files"},
    {"mission": "Trouver fichiers par type récursivement", "skills_used": ["run_command"], "learned": "find /path -name '*.pdf' -type f. split('\\n').filter(Boolean) -> tableau.", "category": "files"},
    {"mission": "Compresser dossier ZIP", "skills_used": ["run_command"], "learned": "zip -r archive.zip /path/folder. tar.gz: tar -czf archive.tar.gz folder/.", "category": "files"},
    {"mission": "Calculer taille dossier", "skills_used": ["run_command"], "learned": "du -sh /path. -s=summary -h=human. Résultat: '1.2G\\t/path'.", "category": "files"},
    {"mission": "Vérifier port ouvert", "skills_used": ["run_command"], "learned": "lsof -i :PORT ou nc -z localhost PORT. lsof plus fiable macOS.", "category": "system"},
    {"mission": "Surveiller processus redémarrer si mort", "skills_used": ["run_command"], "learned": "pgrep -f name || (cmd &). Ghost OS self_healing_daemon fait ça :8001-:8019.", "category": "system"},
    {"mission": "IP LAN de la machine", "skills_used": ["run_command"], "learned": "ipconfig getifaddr en0 (macOS). ip addr show (Linux). hostname -I (Linux aussi).", "category": "system"},
    {"mission": "Sync skills avec Reine centrale", "skills_used": ["http_fetch"], "learned": "POST localhost:8019/sync force sync. GET /status -> last_sync. REINE_URL dans .env.", "category": "ghost_os"},
    {"mission": "Publier skill hub Reine", "skills_used": ["http_fetch"], "learned": "POST localhost:8019/publish/{name}. Direct: POST {REINE_URL}/api/v1/hub/skills/publish.", "category": "ghost_os"},
    {"mission": "Voir Ruches connectées santé fleet", "skills_used": ["http_fetch"], "learned": "GET {REINE_URL}/api/v1/ruches -> [{ruche_id, health: up|stale|down, age_s}].", "category": "ghost_os"},
    {"mission": "Générer skill via Evolution layer", "skills_used": ["http_fetch"], "learned": "POST localhost:8005/generate-skill-node {name, goal, examples}. Sandbox 5 couches auto.", "category": "ghost_os"},
    {"mission": "Recherche sémantique mémoire ChromaDB", "skills_used": ["http_fetch"], "learned": "POST localhost:8006/semantic_search {query, n_results:5}. Ollama nomic-embed-text.", "category": "ghost_os"},
    {"mission": "Importer skills GitHub sécurisé", "skills_used": [], "learned": "python3 scripts/import_github_skills.py https://github.com/user/repo --validate --quarantine.", "category": "ghost_os"},
    {"mission": "Validation input avant exécution", "skills_used": [], "learned": "/^[a-zA-Z0-9_\\-.]+$/.test(input). Jamais eval() ou Function(). Pas d'injection shell.", "category": "security"},
    {"mission": "Stocker secret de manière sécurisée", "skills_used": [], "learned": "Variables .env jamais committées. Ghost OS CHIMERA_SECRET dans .env. macOS Keychain pour permanents.", "category": "security"},
    {"mission": "Vérifier intégrité fichier téléchargé", "skills_used": ["run_command"], "learned": "shasum -a 256 file.zip. Comparer avec hash publié. Jamais exécuter sans vérification.", "category": "security"},
    {"mission": "Parser valider JSON avec schema", "skills_used": [], "learned": "Zod: z.object({...}).parse(data). Erreur claire si invalide. JSON.parse toujours dans try/catch.", "category": "data"},
    {"mission": "Dédupliquer tableau objets par clé", "skills_used": [], "learned": "[...new Map(arr.map(item => [item.key, item])).values()]. Préserve dernier occurrence.", "category": "data"},
]


def _read_existing(filepath):
    existing = set()
    if filepath.exists():
        for line in filepath.read_text("utf-8").splitlines():
            try:
                obj = json.loads(line)
                key = obj.get("mission", obj.get("text", ""))[:60]
                if key:
                    existing.add(key)
            except Exception:
                pass
    return existing


def seed_offline(seeds, dry_run=False):
    EPISODES_FILE.parent.mkdir(parents=True, exist_ok=True)
    existing_ep  = _read_existing(EPISODES_FILE)
    existing_heu = _read_existing(HEURISTICS_FILE)
    now = datetime.now(timezone.utc).isoformat()
    new_ep, new_heu = [], []

    for i, seed in enumerate(seeds):
        if seed["mission"][:60] not in existing_ep:
            new_ep.append({"id": f"seed_{datetime.now(timezone.utc).strftime('%Y%m%d')}_{i:04d}", "mission": seed["mission"], "result": seed["learned"], "success": True, "duration_ms": 500 + (i*37) % 4500, "model_used": "seed/knowledge-base", "skills_used": seed.get("skills_used", []), "learned": seed["learned"], "machine_id": "seed", "timestamp": now, "category": seed.get("category", "general")})
        if seed["learned"][:60] not in existing_heu:
            new_heu.append({"id": f"heuristic_{i:04d}", "text": seed["learned"], "source": "seed", "category": seed.get("category", "general"), "skills_involved": seed.get("skills_used", []), "timestamp": now})

    if dry_run:
        print(f"[DRY-RUN] {len(new_ep)} épisodes, {len(new_heu)} heuristiques a ajouter")
        return

    with open(EPISODES_FILE, "a", encoding="utf-8") as f:
        for ep in new_ep: f.write(json.dumps(ep, ensure_ascii=False) + "\n")
    with open(HEURISTICS_FILE, "a", encoding="utf-8") as f:
        for h in new_heu: f.write(json.dumps(h, ensure_ascii=False) + "\n")

    print(f"[Seed] {len(new_ep)} episodes, {len(new_heu)} heuristiques ajoutees ({len(seeds)-len(new_ep)} doublons ignores)")


async def seed_live(seeds, dry_run=False):
    if not _HTTPX:
        print("httpx manquant -> fallback offline"); seed_offline(seeds, dry_run); return
    try:
        async with httpx.AsyncClient(timeout=5) as c:
            await c.get(f"{MEMORY_URL}/health")
    except Exception as e:
        print(f"Memory layer DOWN ({e}) -> fallback offline"); seed_offline(seeds, dry_run); return

    posted = 0
    async with httpx.AsyncClient(timeout=15) as c:
        for i, seed in enumerate(seeds):
            payload = {"mission": seed["mission"], "result": seed["learned"], "success": True, "duration_ms": 500, "model_used": "seed/knowledge-base", "skills_used": seed.get("skills_used", []), "learned": seed["learned"], "machine_id": "seed"}
            if dry_run: print(f"  [DRY] {seed['mission'][:60]}"); continue
            try:
                r = await c.post(f"{MEMORY_URL}/episode", json=payload)
                if r.status_code == 200: posted += 1
            except Exception: pass
    if not dry_run:
        print(f"[Seed] {posted}/{len(seeds)} episodes indexes dans ChromaDB")
        try:
            async with httpx.AsyncClient(timeout=30) as c: await c.post(f"{MEMORY_URL}/reindex")
        except Exception: pass


def count_entries():
    ep  = sum(1 for _ in open(EPISODES_FILE)) if EPISODES_FILE.exists() else 0
    heu = sum(1 for _ in open(HEURISTICS_FILE)) if HEURISTICS_FILE.exists() else 0
    seed_ep = sum(1 for l in open(EPISODES_FILE) if '"machine_id": "seed"' in l) if EPISODES_FILE.exists() else 0
    print(f"\nMemoire Ghost OS: {ep} episodes ({ep-seed_ep} reels + {seed_ep} seeds), {heu} heuristiques")
    cats = {}
    if EPISODES_FILE.exists():
        for line in open(EPISODES_FILE):
            try: cat = json.loads(line).get("category","?"); cats[cat] = cats.get(cat,0)+1
            except Exception: pass
    for cat, n in sorted(cats.items(), key=lambda x: -x[1]): print(f"  {cat:<20}: {n}")


def main():
    p = argparse.ArgumentParser(description="seed_brain.py - Pre-charge le cerveau Ghost OS")
    p.add_argument("--live",      action="store_true")
    p.add_argument("--category",  type=str)
    p.add_argument("--dry-run",   action="store_true")
    p.add_argument("--count",     action="store_true")
    p.add_argument("--list",      action="store_true")
    args = p.parse_args()

    if args.count: count_entries(); return
    if args.list:
        cats = sorted(set(s.get("category","?") for s in SEEDS))
        for cat in cats: print(f"  {cat}: {len([s for s in SEEDS if s.get('category')==cat])}")
        return

    seeds = [s for s in SEEDS if s.get("category") == args.category] if args.category else SEEDS
    if args.category and not seeds: print(f"Categorie '{args.category}' introuvable"); sys.exit(1)
    print(f"Ghost OS Brain Seeder — {len(seeds)} patterns, mode={'live' if args.live else 'offline'}")

    if args.live: asyncio.run(seed_live(seeds, args.dry_run))
    else: seed_offline(seeds, args.dry_run)


if __name__ == "__main__":
    main()
