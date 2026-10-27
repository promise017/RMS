"use client";

import { useState } from "react";
import { Field } from "./ui";

// No look-alike characters (0/O, 1/l/I), so a password read out loud is typed correctly
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";

// e.g. "hT7k-Q9mx-W3pa": long enough to pass the server's rules, easy to read out
export function suggestPassword() {
  const bytes = new Uint32Array(12);
  crypto.getRandomValues(bytes);
  const chars = Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join("");
  return `${chars.slice(0, 4)}-${chars.slice(4, 8)}-${chars.slice(8)}`;
}

// "New password" + "Confirm" with a show/hide toggle. reveal shows them (e.g. after suggesting one).
export function NewPasswordFields({ value, onChange, errors = {}, idPrefix, autoFocus, reveal = false }) {
  const [toggled, setShown] = useState(null);
  const shown = toggled ?? reveal;
  const type = shown ? "text" : "password";

  return (
    <>
      <Field id={`${idPrefix}-new`} label="New password" error={errors.new_password}
        hint="At least 8 characters. Avoid common words and only numbers.">
        <div style={{ display: "flex", gap: 6 }}>
          <input id={`${idPrefix}-new`} type={type} className={`input ${errors.new_password ? "invalid" : ""}`}
            value={value.new_password} onChange={(e) => onChange({ ...value, new_password: e.target.value })}
            autoComplete="new-password" autoFocus={autoFocus} spellCheck={false} />
          <button type="button" className="btn btn-quiet" onClick={() => setShown(!shown)} aria-pressed={shown}>
            {shown ? "Hide" : "Show"}
          </button>
        </div>
      </Field>
      <Field id={`${idPrefix}-confirm`} label="Type it again" error={errors.confirm_password}>
        <input id={`${idPrefix}-confirm`} type={type} className={`input ${errors.confirm_password ? "invalid" : ""}`}
          value={value.confirm_password} onChange={(e) => onChange({ ...value, confirm_password: e.target.value })}
          autoComplete="new-password" spellCheck={false} />
      </Field>
    </>
  );
}

// Quick checks before asking the server (which applies the full rules)
export function checkNewPassword({ new_password, confirm_password }) {
  const errors = {};
  if (new_password.length < 8) errors.new_password = "Use at least 8 characters.";
  else if (/^\d+$/.test(new_password)) errors.new_password = "It can't be only numbers.";
  if (!errors.new_password && confirm_password !== new_password) errors.confirm_password = "The two passwords don't match.";
  return errors;
}
