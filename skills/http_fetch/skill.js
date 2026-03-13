// Skill: http_fetch — Fetch une URL et retourne le texte brut
export async function run({ url, method = "GET", headers = {}, body = null }) {
  if (!url) return { success: false, error: "url requis" };
  try {
    const opts = { method, headers, signal: AbortSignal.timeout(15000) };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(url, opts);
    const text = await res.text();
    return { success: true, result: text.slice(0, 4000), status: res.status };
  } catch (e) {
    return { success: false, error: e.message };
  }
}
