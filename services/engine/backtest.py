"""'What if I had invested $1,000 a year ago?' using stored daily closes."""

from dataclasses import dataclass
from datetime import date
from decimal import ROUND_HALF_UP, Decimal

from prices import Close

CENTS = Decimal("0.01")


class NotEnoughHistory(ValueError):
    pass


@dataclass(frozen=True)
class BacktestResult:
    symbol: str
    amount: Decimal
    start_date: date
    start_price: Decimal
    end_date: date
    end_price: Decimal
    end_value: Decimal
    return_pct: Decimal
    max_drawdown_pct: Decimal  # negative, e.g. -18.7
    drawdown_peak_date: date
    drawdown_trough_date: date


def backtest(symbol: str, closes: list[Close], amount: Decimal) -> BacktestResult:
    if amount <= 0:
        raise ValueError("Amount must be more than zero.")
    if len(closes) < 2:
        raise NotEnoughHistory(f"Not enough price history for {symbol} in that range.")

    first, last = closes[0], closes[-1]
    shares = amount / first.close
    end_value = (shares * last.close).quantize(CENTS, ROUND_HALF_UP)

    peak = first
    worst = Decimal(0)
    worst_peak, worst_trough = first.day, first.day
    for c in closes:
        if c.close > peak.close:
            peak = c
        drawdown = (c.close - peak.close) / peak.close
        if drawdown < worst:
            worst, worst_peak, worst_trough = drawdown, peak.day, c.day

    return BacktestResult(
        symbol=symbol,
        amount=amount,
        start_date=first.day,
        start_price=first.close,
        end_date=last.day,
        end_price=last.close,
        end_value=end_value,
        return_pct=((end_value - amount) / amount * 100).quantize(Decimal("0.1"), ROUND_HALF_UP),
        max_drawdown_pct=(worst * 100).quantize(Decimal("0.1"), ROUND_HALF_UP),
        drawdown_peak_date=worst_peak,
        drawdown_trough_date=worst_trough,
    )
