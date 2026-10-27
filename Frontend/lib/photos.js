// Django returns file links like http://127.0.0.1:8000/media/...; load them through
// the /backend proxy instead so they also work on phones on the same Wi-Fi
export function photoSrc(url) {
  if (!url) return url;
  try {
    return "/backend" + new URL(url, window.location.origin).pathname;
  } catch {
    return url;
  }
}
