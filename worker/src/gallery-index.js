/** The ids published in the gallery's index.json, or null when it cannot be read. Cached at the edge for five minutes. */
export async function publishedIds(env, fetchImpl) {
  try {
    const response = await fetchImpl(env.GALLERY_INDEX_URL, { cf: { cacheTtl: 300, cacheEverything: true } });
    if (!response.ok) return null;
    const index = await response.json();
    const entries = Array.isArray(index) ? index : Array.isArray(index.scripts) ? index.scripts : Array.isArray(index.entries) ? index.entries : [];
    return new Set(entries.map((entry) => entry && entry.id).filter((id) => typeof id === "string"));
  } catch {
    return null;
  }
}
