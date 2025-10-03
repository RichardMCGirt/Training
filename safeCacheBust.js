// safeCacheBust.js
export function addCacheBust(u) {
  try {
    const url = new URL(u);
    url.searchParams.set("cb", Date.now().toString());
    return url.toString();
  } catch {
    // fallback if u isn't absolute; still preserve existing query
    const sep = u.includes("?") ? "&" : "?";
    return u + sep + "cb=" + Date.now();
  }
}
