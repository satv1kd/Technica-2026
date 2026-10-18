"use client";

import { hasDetails, money, orderTitle, priceLine, type ProposalLike } from "../lib/trade";

interface Props {
  proposal: ProposalLike;
  secondsLeft: number;
  expired: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Step 2 of a trade: the read-back, a 60-second offer, Enter or Escape. */
export function ConfirmPanel({ proposal, secondsLeft, expired, onConfirm, onCancel }: Props) {
  return (
    <section className="confirm-panel" aria-label="Confirm your practice trade">
      {hasDetails(proposal) ? (
        <>
          <h2 className="confirm-title">{orderTitle(proposal)}</h2>
          <dl className="confirm-facts">
            <div><dt className="sr-only">Price</dt><dd>{priceLine(proposal)}</dd></div>
            <div><dt className="sr-only">Total</dt><dd className="confirm-total">Total: {money(proposal.total)}</dd></div>
          </dl>
          <p className="confirm-risk">This is practice money. {proposal.risk_note}</p>
        </>
      ) : (
        // Without full order details, show the read-back the tutor speaks.
        <p className="confirm-risk">{proposal.readback}</p>
      )}
      {proposal.price_note && <p className="confirm-note">{proposal.price_note}</p>}
      {expired ? (
        <p className="confirm-expired" role="alert">Offer expired. Press Enter to get a new price, or Escape to cancel.</p>
      ) : (
        <p className="confirm-timer" aria-live="off">
          Offer good for <span className="confirm-seconds">{secondsLeft}</span> more seconds
        </p>
      )}
      <div className="confirm-actions">
        <button type="button" className="confirm-button confirm-yes" onClick={onConfirm}>
          <span className="dock-key">Enter</span> {expired ? "Get a new price" : proposal.side === "sell" ? "Confirm sale" : "Confirm purchase"}
        </button>
        <button type="button" className="confirm-button" onClick={onCancel}>
          <span className="dock-key">Esc</span> Cancel
        </button>
      </div>
    </section>
  );
}
