"use client";

import { useState } from "react";
import { explorerLink, money, settlementBars, type Portfolio, type Settlement, type TradeResult } from "../lib/trade";

export interface HistoryPoint {
  date: string;
  close: number;
}

interface Props {
  /** The filled trade, or null while it's still a preview on the confirm screen. */
  result: TradeResult | null;
  preview?: { side: string; symbol: string; quantity: number; price: number; total: number };
  history: HistoryPoint[] | null;
  portfolio: Portfolio | null;
}

const W = 560, H = 160, PAD = 14;

/** 30-day price line with the trade marked; hover shows date and price. */
function PriceChart({ history, marker }: { history: HistoryPoint[]; marker: { side: string; price: number } | null }) {
  const [hover, setHover] = useState<number | null>(null);
  const closes = history.map((p) => p.close);
  const lo = Math.min(...closes, marker?.price ?? Infinity), hi = Math.max(...closes, marker?.price ?? -Infinity);
  const x = (i: number) => PAD + (i / Math.max(1, history.length - 1)) * (W - 2 * PAD);
  const y = (v: number) => H - PAD - ((v - lo) / Math.max(hi - lo, 0.01)) * (H - 2 * PAD);
  const path = history.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.close).toFixed(1)}`).join(" ");
  const last = history.length - 1;
  const first = history[0], end = history[last];
  const summary = `${history.length} trading days from ${first.date} to ${end.date}, from ${money(first.close)} to ${money(end.close)}.` +
    (marker ? ` Your ${marker.side} is marked at ${money(marker.price)} today.` : "");
  const shown = hover ?? null;
  return (
    <figure className="results-chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Price chart. ${summary}`}
        onPointerMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const fx = ((e.clientX - r.left) / r.width) * W;
          setHover(Math.round(((fx - PAD) / (W - 2 * PAD)) * last));
        }}
        onPointerLeave={() => setHover(null)}>
        <path d={path} className="results-line" fill="none" />
        {marker && (
          <g className="results-marker">
            <circle cx={x(last)} cy={y(marker.price)} r="7" />
            {/* Label to the left of the marker, kept inside the chart. */}
            <text x={x(last) - 14} y={Math.min(H - PAD, Math.max(PAD + 10, y(marker.price) + 5))} textAnchor="end">
              {marker.side === "buy" ? "Bought" : "Sold"}
            </text>
          </g>
        )}
        {shown !== null && shown >= 0 && shown <= last && (
          <g className="results-hover">
            <line x1={x(shown)} x2={x(shown)} y1={PAD} y2={H - PAD} />
            <circle cx={x(shown)} cy={y(history[shown].close)} r="4" />
          </g>
        )}
      </svg>
      {shown !== null && shown >= 0 && shown <= last && (
        <figcaption className="results-tooltip" role="status">
          {history[shown].date}: {money(history[shown].close)}
        </figcaption>
      )}
    </figure>
  );
}

function SettlementBars({ settlement }: { settlement: Settlement | null }) {
  return (
    <ul className="settle-bars" aria-label="How long settlement takes">
      {settlementBars(settlement).map((b) => (
        <li key={b.label}>
          <span className="settle-label">{b.label}</span>
          <span className="settle-track" aria-hidden="true">
            <span className="settle-fill" style={{ width: `${Math.max(3, b.fraction * 100)}%` }} />
          </span>
          <span className="settle-value">{b.value}</span>
        </li>
      ))}
    </ul>
  );
}

function AccountBar({ portfolio }: { portfolio: Portfolio }) {
  const total = Math.max(portfolio.total_value, 0.01);
  const held = (portfolio.invested / total) * 100;
  return (
    <div className="account">
      <div className="account-track" aria-hidden="true">
        <span className="account-held" style={{ width: `${held}%` }} />
      </div>
      <p className="account-legend">
        <span><span className="swatch swatch-held" aria-hidden="true" /> Holdings {money(portfolio.invested)}</span>
        <span><span className="swatch swatch-cash" aria-hidden="true" /> Cash {money(portfolio.cash)}</span>
      </p>
    </div>
  );
}

/** The trade results panel for sighted observers; everything here is also spoken. */
export function TradeResults({ result, preview, history, portfolio }: Props) {
  const t = result?.trade ?? null;
  const row = t ?? preview;
  const status = !result ? "Waiting for confirmation"
    : result.settlement.kind === "onchain" ? "Settled on Solana devnet"
    : result.settlement.kind === "simulated" ? "Recorded, simulated settlement"
    : "Filled, settles next business day";
  const link = result ? explorerLink(result.settlement) : null;
  return (
    <section className="results" aria-label={result ? "Trade results" : "Trade preview"}>
      {row && (
        <table className="receipt">
          <thead>
            <tr><th>Order</th><th>Asset</th><th>Shares</th><th>Price</th><th>Total</th><th>Status</th></tr>
          </thead>
          <tbody>
            <tr>
              <td>{row.side === "buy" ? "Buy" : "Sell"}</td>
              <td>{row.symbol}</td>
              <td>{row.quantity}</td>
              <td>{money(row.price)}</td>
              <td>{money(row.total)}</td>
              <td>{status}</td>
            </tr>
          </tbody>
        </table>
      )}
      {history && history.length > 1 && (
        <PriceChart history={history} marker={row ? { side: row.side, price: row.price } : null} />
      )}
      {row?.symbol === "PVOO" || result?.settlement.kind === "onchain" ? <SettlementBars settlement={result?.settlement ?? null} /> : null}
      {result && portfolio && <AccountBar portfolio={portfolio} />}
      {result && portfolio?.tip && <p className="coach-tip">Habit tip: {portfolio.tip}</p>}
      {link && (
        <p className="explorer">
          <a href={link.href} target="_blank" rel="noreferrer">
            {link.example ? "See an earlier PVOO trade on the Solana Explorer" : "See this trade on the Solana Explorer"}
          </a>
        </p>
      )}
    </section>
  );
}
