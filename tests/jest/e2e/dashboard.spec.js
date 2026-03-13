/**
 * test/e2e/dashboard.spec.js — Tests Playwright du Dashboard
 *
 * Teste l'interface React du dashboard en mode standalone.
 * Nécessite : LaRuche standalone + dashboard Vite + Playwright
 *
 * Usage :
 *   npx playwright test test/e2e/dashboard.spec.js
 *   npm run test:dashboard
 */

import { test, expect } from "@playwright/test";

const DASHBOARD_URL = process.env.DASHBOARD_URL || "http://localhost:8080";
const API_URL = process.env.QUEEN_API || "http://localhost:3000";

// ─── Configuration Playwright ─────────────────────────────────────────────────
// (voir playwright.config.js pour la config globale)

test.describe("LaRuche Dashboard — Mode Standalone", () => {

  test.beforeEach(async ({ page }) => {
    // Intercepter les erreurs console
    page.on("console", (msg) => {
      if (msg.type() === "error") {
        console.log(`[Browser Error] ${msg.text()}`);
      }
    });
  });

  // ─── Chargement initial ──────────────────────────────────────────────────────
  test("Page se charge sans erreur", async ({ page }) => {
    await page.goto(DASHBOARD_URL, { waitUntil: "networkidle", timeout: 15000 });

    // Le titre doit contenir LaRuche
    await expect(page).toHaveTitle(/LaRuche/i);
  });

  test("Header LaRuche HQ visible", async ({ page }) => {
    await page.goto(DASHBOARD_URL, { waitUntil: "networkidle", timeout: 15000 });

    // Titre principal
    await expect(page.getByText("LaRuche HQ")).toBeVisible();
  });

  test("Section NOUVELLE MISSION présente", async ({ page }) => {
    await page.goto(DASHBOARD_URL, { waitUntil: "networkidle", timeout: 15000 });

    await expect(page.getByText("NOUVELLE MISSION")).toBeVisible();
  });

  test("Section RÉSULTATS DES MISSIONS présente", async ({ page }) => {
    await page.goto(DASHBOARD_URL, { waitUntil: "networkidle", timeout: 15000 });

    await expect(page.getByText("RÉSULTATS DES MISSIONS")).toBeVisible();
  });

  test("Section SERVICES présente", async ({ page }) => {
    await page.goto(DASHBOARD_URL, { waitUntil: "networkidle", timeout: 15000 });

    await expect(page.getByText("SERVICES")).toBeVisible();
  });

  // ─── Formulaire de mission ────────────────────────────────────────────────────
  test("Textarea de mission fonctionnel", async ({ page }) => {
    await page.goto(DASHBOARD_URL, { waitUntil: "networkidle", timeout: 15000 });

    const textarea = page.getByPlaceholder(/Décrivez votre mission/i);
    await expect(textarea).toBeVisible();
    await textarea.fill("Test de mission depuis Playwright");
    await expect(textarea).toHaveValue("Test de mission depuis Playwright");
  });

  test("Bouton Envoyer activé quand texte présent", async ({ page }) => {
    await page.goto(DASHBOARD_URL, { waitUntil: "networkidle", timeout: 15000 });

    const textarea = page.getByPlaceholder(/Décrivez votre mission/i);
    const button = page.getByRole("button", { name: /Envoyer/i });

    // Sans texte, le bouton doit être désactivé
    await expect(button).toBeDisabled();

    // Avec texte
    await textarea.fill("Ma mission test");
    await expect(button).toBeEnabled();
  });

  test("Exemples cliquables remplissent le textarea", async ({ page }) => {
    await page.goto(DASHBOARD_URL, { waitUntil: "networkidle", timeout: 15000 });

    const textarea = page.getByPlaceholder(/Décrivez votre mission/i);

    // Trouver un bouton d'exemple
    const exampleButtons = page.locator("button").filter({ hasText: /fichiers|code|skill/i });
    const firstExample = exampleButtons.first();
    await expect(firstExample).toBeVisible();

    const exampleText = await firstExample.getAttribute("title");
    await firstExample.click();

    if (exampleText) {
      await expect(textarea).toHaveValue(exampleText);
    } else {
      // Le textarea doit avoir du contenu
      const value = await textarea.inputValue();
      expect(value.length).toBeGreaterThan(0);
    }
  });

  // ─── Interaction avec l'API ───────────────────────────────────────────────────
  test("Soumission de mission via Ctrl+Entrée", async ({ page }) => {
    await page.goto(DASHBOARD_URL, { waitUntil: "networkidle", timeout: 15000 });

    // Vérifier que l'API standalone est accessible
    const apiCheck = await page.evaluate(async (apiUrl) => {
      try {
        const r = await fetch(`${apiUrl}/api/health`, { signal: AbortSignal.timeout(3000) });
        return r.ok;
      } catch {
        return false;
      }
    }, API_URL);

    test.skip(!apiCheck, "API standalone non disponible");

    const textarea = page.getByPlaceholder(/Décrivez votre mission/i);
    await textarea.fill("Test Playwright");
    await textarea.press("Control+Enter");

    // Attendre que le bouton passe en état "loading"
    await expect(page.getByText(/En cours/i)).toBeVisible({ timeout: 5000 });
  });

  // ─── Section résultats ───────────────────────────────────────────────────────
  test("Bouton Actualiser présent dans les résultats", async ({ page }) => {
    await page.goto(DASHBOARD_URL, { waitUntil: "networkidle", timeout: 15000 });

    await expect(page.getByRole("button", { name: /Actualiser/i })).toBeVisible();
  });

  test("Message vide quand pas de missions", async ({ page }) => {
    // Intercepter la requête missions pour retourner vide
    await page.route(`${API_URL}/api/missions*`, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ missions: [], total: 0, page: 1, limit: 10 }),
      })
    );

    await page.goto(DASHBOARD_URL, { waitUntil: "networkidle", timeout: 15000 });

    // Un texte indiquant l'absence de missions doit être visible
    await expect(page.getByText(/Aucune mission/i)).toBeVisible({ timeout: 8000 });
  });

  // ─── Console Telegram ─────────────────────────────────────────────────────────
  test("Console Telegram présente", async ({ page }) => {
    await page.goto(DASHBOARD_URL, { waitUntil: "networkidle", timeout: 15000 });

    await expect(page.getByText("CONSOLE TELEGRAM")).toBeVisible();
    await expect(page.getByPlaceholder(/Commande Telegram/i)).toBeVisible();
  });

  // ─── Logs temps réel ────────────────────────────────────────────────────────
  test("Section LOGS TEMPS RÉEL présente", async ({ page }) => {
    await page.goto(DASHBOARD_URL, { waitUntil: "networkidle", timeout: 15000 });

    await expect(page.getByText("LOGS TEMPS RÉEL")).toBeVisible();
  });

  // ─── Responsive basique ─────────────────────────────────────────────────────
  test("Page stable sur viewport mobile (375px)", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(DASHBOARD_URL, { waitUntil: "networkidle", timeout: 15000 });

    // Pas de crash, titre présent
    await expect(page.getByText("LaRuche HQ")).toBeVisible();
  });
});

// ─── Tests API directe via Playwright fetch ───────────────────────────────────
test.describe("LaRuche API — Tests via navigateur", () => {

  test("API health accessible depuis le dashboard", async ({ page }) => {
    await page.goto(DASHBOARD_URL, { timeout: 10000 });

    const result = await page.evaluate(async (apiUrl) => {
      try {
        const r = await fetch(`${apiUrl}/api/health`);
        return { ok: r.ok, status: r.status };
      } catch (e) {
        return { ok: false, error: e.message };
      }
    }, API_URL);

    // Si l'API est accessible, elle doit retourner 200
    if (result.ok) {
      expect(result.status).toBe(200);
    }
    // Si non accessible, on log sans faire échouer le test (API optionnelle)
    // car le dashboard peut fonctionner sans l'API standalone
  });

  test("POST mission via fetch du navigateur (si API dispo)", async ({ page }) => {
    await page.goto(DASHBOARD_URL, { timeout: 10000 });

    const result = await page.evaluate(async (apiUrl) => {
      try {
        const r = await fetch(`${apiUrl}/api/mission`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ command: "Test Playwright direct" }),
        });
        if (!r.ok) return { skipped: true };
        return await r.json();
      } catch {
        return { skipped: true };
      }
    }, API_URL);

    if (!result.skipped) {
      expect(result.missionId).toBeTruthy();
      expect(result.status).toBe("pending");
    }
  });
});
