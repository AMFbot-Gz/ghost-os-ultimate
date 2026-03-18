/**
 * src/metiers.js — Fiches Métier Jarvis (JS runtime)
 *
 * Chaque fiche = domaine professionnel avec workflows, triggers Telegram,
 * et étapes ordonnées avec validation.
 *
 * Usage :
 *   import { matchFicheMetier, FICHES_METIER } from './metiers.js';
 *   const { fiche, workflow } = matchFicheMetier('rapport ventes du jour');
 */

// ─── Fiches Métier ────────────────────────────────────────────────────────────

export const FICHES_METIER = [
  {
    id: 'ecommerce',
    nom: 'E-commerce Manager',
    description: 'Gestion Shopify — commandes, stocks, CA, clients',
    skills_requis: ['shopify-backend', 'email-triage', 'google-workspace'],
    workflows: [
      {
        nom: 'Rapport quotidien ventes',
        declencheur: ['rapport ventes', 'chiffres du jour', 'commandes aujourd', 'ca du jour', 'chiffre affaires', 'ventes du jour'],
        etapes: [
          { ordre: 1, skill: 'shopify-backend', params: { action: 'getOrders', status: 'any', limit: 50 }, validation: 'liste commandes non vide' },
          { ordre: 2, skill: 'shopify-backend', params: { action: 'getRevenue', period: 'today' }, validation: 'chiffre >= 0' },
        ],
        livrable: 'X commandes, Y€ CA',
      },
      {
        nom: 'Stock critique',
        declencheur: ['stock faible', 'rupture', 'inventaire', 'produits en rupture'],
        etapes: [
          { ordre: 1, skill: 'shopify-backend', params: { action: 'getLowStock', threshold: 5 }, validation: 'liste produits' },
        ],
        livrable: 'Liste produits en rupture',
      },
      {
        nom: 'Commandes en attente',
        declencheur: ['commandes en attente', 'commandes non traitées', 'orders pending'],
        etapes: [
          { ordre: 1, skill: 'shopify-backend', params: { action: 'getOrders', status: 'pending' }, validation: 'liste commandes' },
        ],
        livrable: 'X commandes en attente',
      },
    ],
    exemples_telegram: ['rapport ventes du jour', 'quels produits en rupture', 'combien de commandes en attente'],
  },

  {
    id: 'assistant-personnel',
    nom: 'Assistant Personnel',
    description: 'Emails, agenda, organisation quotidienne',
    skills_requis: ['email-triage', 'google-workspace'],
    workflows: [
      {
        nom: 'Briefing matinal',
        declencheur: ['briefing', 'quoi aujourd hui', 'planning du jour', 'resume du matin', 'resumé matin', 'brief'],
        etapes: [
          { ordre: 1, skill: 'email-triage', params: { action: 'fetchRecent', hours: 8 }, validation: 'emails récupérés' },
          { ordre: 2, skill: 'google-workspace', params: { action: 'listEvents', days: 1 }, validation: 'événements récupérés' },
          { ordre: 3, skill: 'email-triage', params: { action: 'classify' }, validation: 'priorités assignées' },
        ],
        livrable: 'X emails (Y urgents), Z réunions',
      },
      {
        nom: 'Triage emails',
        declencheur: ['trie mes emails', 'emails urgents', 'nouveaux emails', 'boite mail', 'mes emails'],
        etapes: [
          { ordre: 1, skill: 'email-triage', params: { action: 'fetchUnread' }, validation: 'non lus' },
          { ordre: 2, skill: 'email-triage', params: { action: 'classify' }, validation: 'priorités' },
        ],
        livrable: 'X emails — Y urgents, Z en attente',
      },
    ],
    exemples_telegram: ['briefing du matin', 'trie mes emails urgents', 'quelles réunions demain'],
  },

  {
    id: 'developpeur',
    nom: 'Assistant Développeur',
    description: 'Git, tests, Docker, monitoring, logs',
    skills_requis: ['run_command', 'run_shell', 'docker_control'],
    workflows: [
      {
        nom: 'Monitoring système',
        declencheur: ['etat du serveur', 'monitoring', 'logs erreur', 'sante systeme', 'pm2 list', 'status systeme'],
        etapes: [
          { ordre: 1, skill: 'run_shell', params: { cmd: 'pm2 list --no-color' }, validation: 'liste PM2' },
          { ordre: 2, skill: 'run_command', params: { cmd: 'df -h / | tail -1' }, validation: 'disque' },
        ],
        livrable: 'X processus PM2, Y% disque',
      },
      {
        nom: 'Audit complet système',
        declencheur: ['audit complet', 'audit systeme', 'analyse systeme', 'rapport systeme', 'audit de mon systeme'],
        etapes: [
          { ordre: 1, skill: 'run_shell', params: { cmd: 'pm2 list --no-color' }, validation: 'processus' },
          { ordre: 2, skill: 'run_command', params: { cmd: 'df -h /' }, validation: 'disque' },
          { ordre: 3, skill: 'run_command', params: { cmd: 'vm_stat | head -5' }, validation: 'mémoire' },
          { ordre: 4, skill: 'ollama_control', params: { action: 'list' }, validation: 'modèles' },
          { ordre: 5, skill: 'docker_control', params: { action: 'ps' }, validation: 'containers' },
        ],
        livrable: 'PM2, disque, RAM, Ollama, Docker',
      },
      {
        nom: 'Logs erreurs',
        declencheur: ['montre les logs', 'logs de', 'erreurs dans', 'debug', 'logs erreurs'],
        etapes: [
          { ordre: 1, skill: 'run_shell', params: { cmd: 'pm2 logs --lines 30 --nostream 2>&1 | head -60' }, validation: 'logs' },
        ],
        livrable: 'Derniers logs avec erreurs',
      },
    ],
    exemples_telegram: ['état du serveur', 'audit complet', 'logs erreurs queen-node'],
  },

  {
    id: 'creatif',
    nom: 'Assistant Créatif',
    description: 'Screenshots, vision, organisation fichiers',
    skills_requis: ['take_screenshot', 'screen_elements', 'organise_screenshots'],
    workflows: [
      {
        nom: 'Capture et analyse',
        declencheur: ['quoi a lecran', 'vois mon ecran', 'analyse lecran', 'ce que tu vois'],
        etapes: [
          { ordre: 1, skill: 'take_screenshot', params: {}, validation: 'image capturée' },
          { ordre: 2, skill: 'screen_elements', params: {}, validation: 'éléments détectés' },
        ],
        livrable: 'Description de l\'écran',
      },
      {
        nom: 'Organisation screenshots',
        declencheur: ['organise mes screenshots', 'range les screenshots', 'trie les captures'],
        etapes: [
          { ordre: 1, skill: 'organise_screenshots', params: {}, validation: 'déplacés' },
        ],
        livrable: 'X screenshots organisés par date',
      },
    ],
    exemples_telegram: ['analyse mon écran', 'organise mes screenshots'],
  },
];

// ─── Matching ─────────────────────────────────────────────────────────────────

/**
 * Normalise un texte : minuscules + retire accents + ponctuation basique.
 * @param {string} s
 */
function normalize(s) {
  return s.toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/['']/g, ' ');
}

/**
 * Trouve la fiche + workflow correspondant à un message.
 * Retourne { fiche: null, workflow: null } si aucun match.
 *
 * @param {string} message
 * @returns {{ fiche: object|null, workflow: object|null }}
 */
export function matchFicheMetier(message) {
  const msg = normalize(message);
  for (const fiche of FICHES_METIER) {
    for (const workflow of fiche.workflows) {
      const hit = workflow.declencheur.some(d => msg.includes(normalize(d)));
      if (hit) return { fiche, workflow };
    }
  }
  return { fiche: null, workflow: null };
}

/**
 * Liste tous les triggers (utile pour debug / help Telegram).
 */
export function listTriggers() {
  return FICHES_METIER.flatMap(f =>
    f.workflows.map(w => ({ fiche: f.nom, workflow: w.nom, triggers: w.declencheur }))
  );
}

/**
 * Détecte si une commande est ambiguë (besoin de clarification).
 * Retourne la question à poser, ou null si pas ambiguë.
 *
 * @param {string} message
 * @returns {string|null}
 */
export function needsClarification(message) {
  const msg = normalize(message);

  // "fais un rapport" sans précision → demander quel type
  if (/\brapport\b/.test(msg) && !/(ventes?|systeme|emails?|audit)/.test(msg)) {
    return 'Rapport sur quoi — ventes, système, ou emails ?';
  }
  // "montre moi" sans objet clair
  if (/\bmontre(?: moi)?\b$/.test(msg.trim())) {
    return 'Montrer quoi — screenshot, logs, ou statut des agents ?';
  }
  // "analyse" sans cible
  if (/^analyse\b/.test(msg.trim()) && !/(systeme|ecran|projet|dossier|logs?)/.test(msg)) {
    return 'Analyser quoi — l\'écran, le système, ou un projet ?';
  }
  return null;
}
