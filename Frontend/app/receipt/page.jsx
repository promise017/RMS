"use client";

import { useEffect, useState } from "react";
import { Alert, Loading } from "../../components/ui";
import { api, API } from "../../lib/api";
import { formatDate, formatDateTime, money, monthLabel } from "../../lib/format";
import { useGate } from "../../lib/hooks";

// Rupees in words, Nepali/Indian style: 1,25,000 -> "One lakh twenty-five thousand"
const ONES = ["", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve",
  "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];

function below100(n) {
  return n < 20 ? ONES[n] : TENS[Math.floor(n / 10)] + (n % 10 ? `-${ONES[n % 10]}` : "");
}
function below1000(n) {
  const h = Math.floor(n / 100);
  const rest = n % 100;
  return [h ? `${ONES[h]} hundred` : "", rest ? below100(rest) : ""].filter(Boolean).join(" ");
}
function inWords(amount) {
  const rupees = Math.floor(amount);
  const paisa = Math.round((amount - rupees) * 100);
  if (rupees === 0 && paisa === 0) return "Zero rupees only";
  const parts = [];
  let n = rupees;
  const crore = Math.floor(n / 1e7); n %= 1e7;
  const lakh = Math.floor(n / 1e5); n %= 1e5;
  const thousand = Math.floor(n / 1000); n %= 1000;
  if (crore) parts.push(`${below1000(crore)} crore`);
  if (lakh) parts.push(`${below100(lakh)} lakh`);
  if (thousand) parts.push(`${below100(thousand)} thousand`);
  if (n) parts.push(below1000(n));
  let text = parts.join(" ") + (rupees ? " rupees" : "");
  if (paisa) text += `${rupees ? " and " : ""}${below100(paisa)} paisa`;
  return text.charAt(0).toUpperCase() + text.slice(1) + " only";
}

export default function ReceiptPage() {
  const user = useGate("member");
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!user) return;
    const id = new URLSearchParams(window.location.search).get("id");
    if (!id) {
      setError("No receipt selected.");
      return;
    }
    api(API.receipt(id)).then(setData).catch((err) => setError(err.message));
  }, [user]);

  if (!user) return null;

  return (
    <div className="receipt-page">
      <div className="receipt-tools">
        <button type="button" className="btn btn-quiet btn-sm" onClick={() => window.history.back()}>← Back</button>
        {data && <button type="button" className="btn btn-primary btn-sm" onClick={() => window.print()}>Print or save as PDF</button>}
      </div>

      {error && <Alert>{error}</Alert>}
      {!error && !data && <Loading />}

      {data && (
        <article className={`receipt ${data.cancelled ? "is-cancelled" : ""}`}>
          {data.cancelled && <div className="receipt-stamp" aria-label="Cancelled">Cancelled</div>}
          <header className="receipt-head">
            <div>
              <h1>{data.building.name}</h1>
              {data.building.description && <p className="small muted">{data.building.description}</p>}
            </div>
            <div className="receipt-no">
              <div className="small faint">Payment receipt</div>
              <div className="mono">{data.receipt_no}</div>
              <div className="small muted">{formatDate(data.confirmed_at)}</div>
            </div>
          </header>

          <dl className="kv receipt-kv">
            <dt>Received from</dt><dd><b>{data.received_from}</b></dd>
            <dt>Unit</dt><dd>{data.unit.name}, floor {data.unit.floor}</dd>
            <dt>For</dt><dd>{monthLabel(data.period)} bill</dd>
          </dl>

          <table className="lines receipt-lines">
            <tbody>
              {data.items.map((i, n) => <tr key={n}><td>{i.title}</td><td>{money(i.amount)}</td></tr>)}
              <tr className="receipt-subtotal"><td>Bill total</td><td>{money(data.bill_total)}</td></tr>
            </tbody>
            <tfoot>
              <tr><td>Amount received</td><td>{money(data.amount)}</td></tr>
            </tfoot>
          </table>
          <p className="receipt-words">{inWords(Number(data.amount))}</p>

          <dl className="kv receipt-kv">
            <dt>Paid by</dt><dd>{data.kind}{data.reference ? <> · <span className="mono">{data.reference}</span></> : null}</dd>
            <dt>Paid on</dt><dd>{formatDate(data.paid_on)}</dd>
            {Number(data.balance_after) > 0 && <><dt>Still owed</dt><dd>{money(data.balance_after)}</dd></>}
            <dt>Received by</dt><dd>{data.received_by}{data.received_by ? ", Secretary" : ""}</dd>
          </dl>

          {data.cancelled && (
            <p className="receipt-cancel-note">This payment was reversed{data.cancel_reason ? `: ${data.cancel_reason}` : ""}.</p>
          )}
          <footer className="receipt-foot small faint">
            Confirmed {formatDateTime(data.confirmed_at)} · Issued through griha.
          </footer>
        </article>
      )}
    </div>
  );
}
