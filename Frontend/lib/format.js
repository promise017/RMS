// Display helpers shared by every page.

// Rs. 1,25,000 (Indian/Nepali digit grouping), decimals only when there are paise
export function money(value) {
  const n = Number(value);
  return "Rs. " + n.toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

export function formatDate(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export function formatDateTime(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleString("en-GB", {
    day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit",
  });
}

// "2 hours ago", "3 days ago", then the date
export function timeAgo(iso) {
  const seconds = (Date.now() - new Date(iso).getTime()) / 1000;
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} h ago`;
  if (seconds < 86400 * 7) {
    const days = Math.floor(seconds / 86400);
    return days === 1 ? "yesterday" : `${days} days ago`;
  }
  return formatDate(iso);
}

// "2026-10" <-> "October 2026"
export function monthLabel(ym) {
  return new Date(`${ym}-01T00:00:00`).toLocaleDateString("en-GB", { month: "long", year: "numeric" });
}

export function currentMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function shiftMonth(ym, by) {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(y, m - 1 + by, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function plural(n, one, many = one + "s") {
  return `${n} ${n === 1 ? one : many}`;
}

export function unitLabel(unit) {
  return unit ? `${unit.name} · Floor ${unit.floor}` : "";
}

export function firstName(user) {
  return user?.full_name?.split(" ")[0] || user?.username || "";
}

export function formatTime(iso) {
  return new Date(iso).toLocaleTimeString("en-GB", { hour: "numeric", minute: "2-digit", hour12: true });
}

// "45 min", "2 h 10 min", "3 days"
export function duration(fromIso, toIso) {
  const minutes = Math.max(0, Math.round(((toIso ? new Date(toIso) : new Date()) - new Date(fromIso)) / 60000));
  if (minutes < 60) return `${minutes} min`;
  if (minutes < 60 * 24) {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return m ? `${h} h ${m} min` : `${h} h`;
  }
  const days = Math.floor(minutes / (60 * 24));
  return days === 1 ? "1 day" : `${days} days`;
}

// Today's date as YYYY-MM-DD in the viewer's own timezone
export function localDay(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function shiftDay(day, by) {
  const [y, m, d] = day.split("-").map(Number);
  return localDay(new Date(y, m - 1, d + by));
}

export function dayLabel(day) {
  if (day === localDay()) return "Today";
  if (day === shiftDay(localDay(), -1)) return "Yesterday";
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
}
