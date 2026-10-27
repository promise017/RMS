// Talking to the Django API (proxied under /backend by next.config.mjs).
import { getSession, saveTokens, clearSession, readJson } from "./session";

const REFRESH_URL = "/backend/accounts/refresh/";

// Thrown when the user has to log in again (no session, or the refresh token expired too)
export class LoginExpiredError extends Error {
  constructor() {
    super("Your session has expired. Sign in again to continue.");
  }
}

// A failed request, with Django's per-field messages kept for forms
export class ApiError extends Error {
  constructor(message, status, data) {
    super(message);
    this.status = status;
    this.fields = data && typeof data === "object" && !Array.isArray(data) && !data.detail ? data : {};
  }

  // First message for one field, e.g. err.field("title")
  field(name) {
    const value = this.fields[name];
    if (!value) return undefined;
    return Array.isArray(value) ? value.join(" ") : String(value);
  }
}

// Pages often make several calls at once; share one refresh between them
let refreshing = null;

async function refreshAccess(refresh) {
  if (!refresh) return null;
  try {
    const res = await fetch(REFRESH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    saveTokens(data);
    return data.access;
  } catch {
    return null;
  }
}

// fetch() with the access token; when the 15-minute token has expired, gets a new
// one with the refresh token and tries once more.
export async function apiFetch(url, options = {}) {
  const session = getSession();
  if (!session) throw new LoginExpiredError();

  const send = (token) =>
    fetch(url, { ...options, headers: { ...options.headers, Authorization: `Bearer ${token}` } });

  const res = await send(session.access);
  if (res.status !== 401) return res;

  refreshing ??= refreshAccess(session.refresh).finally(() => { refreshing = null; });
  const access = await refreshing;
  if (!access) {
    clearSession();
    throw new LoginExpiredError();
  }
  return send(access);
}

// Turn a DRF error response into one readable sentence
export function errorText(data, status) {
  if (data?.detail) return String(data.detail);
  if (data && typeof data === "object") {
    const parts = Object.entries(data).map(([field, msgs]) => {
      const text = Array.isArray(msgs)
        ? msgs.map((m) => (typeof m === "object" ? Object.values(m).flat().join(" ") : m)).join(" ")
        : String(msgs);
      return field === "non_field_errors" ? text : `${field.replace(/_/g, " ")}: ${text}`;
    });
    if (parts.length) return parts.join(" ");
  }
  if (status >= 500) return `The server ran into a problem (${status}). Check the Django terminal.`;
  return `Something went wrong (${status}).`;
}

/**
 * The one call pages use:  await api(url, { method, json, form })
 * Returns the parsed body (null for 204) or throws ApiError with a readable message.
 * An expired login sends the browser to /login.
 */
export async function api(url, { method = "GET", json, form } = {}) {
  const options = { method };
  if (json !== undefined) {
    options.headers = { "Content-Type": "application/json" };
    options.body = JSON.stringify(json);
  } else if (form) {
    options.body = form;
  }

  let res;
  try {
    res = await apiFetch(url, options);
  } catch (err) {
    if (err instanceof LoginExpiredError) {
      window.location.replace("/login");
      throw new ApiError(err.message, 401, null);
    }
    throw new ApiError("Couldn't reach the server. Check that Django is running.", 0, null);
  }

  const data = res.status === 204 ? null : await readJson(res);
  if (!res.ok) throw new ApiError(errorText(data, res.status), res.status, data);
  return data;
}

// Every API path in one place
export const API = {
  login: "/backend/accounts/login/",
  signup: "/backend/accounts/signup/",
  me: "/backend/accounts/me/",
  changePassword: "/backend/accounts/password/change/",
  resetPassword: (id) => `/backend/accounts/members/${id}/password/reset/`,
  join: "/backend/residency/join/",

  createBuilding: "/backend/residency/api/createbuilding",
  building: "/backend/residency/mybuilding/",
  dashboard: "/backend/residency/mybuilding/dashboard/",
  regenerateCode: "/backend/residency/mybuilding/regenerate-code/",
  buildingImage: (id) => `/backend/residency/mybuilding/images/${id}/`,
  members: "/backend/residency/mybuilding/members/",
  guards: "/backend/residency/mybuilding/guards/",
  guard: (id) => `/backend/residency/mybuilding/guards/${id}/`,
  residentUnit: (id) => `/backend/residency/mybuilding/residents/${id}/unit/`,
  floors: "/backend/residency/mybuilding/floors/",
  copyFloor: (id) => `/backend/residency/mybuilding/floors/${id}/copy/`,
  units: "/backend/residency/mybuilding/units/",
  unit: (id) => `/backend/residency/mybuilding/units/${id}/`,
  unitImage: (id) => `/backend/residency/mybuilding/unit-images/${id}/`,
  complaints: "/backend/residency/mybuilding/complaints/",
  complaint: (id) => `/backend/residency/mybuilding/complaints/${id}/`,
  notices: "/backend/residency/mybuilding/notices/",
  notice: (id) => `/backend/residency/mybuilding/notices/${id}/`,
  bills: "/backend/residency/mybuilding/bills/",
  bulkBills: "/backend/residency/mybuilding/bills/bulk/",
  sendBills: "/backend/residency/mybuilding/bills/send/",
  recordPayment: (billId) => `/backend/residency/mybuilding/bills/${billId}/payments/`,
  payments: "/backend/residency/mybuilding/payments/",
  confirmPayment: (id) => `/backend/residency/mybuilding/payments/${id}/confirm/`,
  rejectPayment: (id) => `/backend/residency/mybuilding/payments/${id}/reject/`,
  paymentMethods: "/backend/residency/mybuilding/payment-methods/",
  paymentMethod: (id) => `/backend/residency/mybuilding/payment-methods/${id}/`,
  myPaymentMethods: "/backend/residency/myunit/payment-methods/",
  reportPayment: (billId) => `/backend/residency/myunit/bills/${billId}/payments/`,
  receipt: (id) => `/backend/residency/payments/${id}/receipt/`,
  bill: (id) => `/backend/residency/mybuilding/bills/${id}/`,

  myUnit: "/backend/residency/myunit/",
  unitChoices: "/backend/residency/myunit/choices/",
  myBills: "/backend/residency/myunit/bills/",
  myComplaints: "/backend/residency/mycomplaints/",
  myComplaint: (id) => `/backend/residency/mycomplaints/${id}/`,
  buildingNotices: "/backend/residency/viewnotice/",
  visitors: "/backend/residency/visitors/",
  checkOut: (id) => `/backend/residency/visitors/${id}/checkout/`,
  visitorLookup: "/backend/residency/visitors/lookup/",
  gateUnits: "/backend/residency/visitors/units/",
  badges: "/backend/residency/badges/",
  markSeen: (section) => `/backend/residency/badges/${section}/seen/`,
};
