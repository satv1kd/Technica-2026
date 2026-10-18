# Task ID: 6

**Title:** Market Data: Chart Series Pipeline with SMA, RDP, and Normalization

**Status:** done

**Dependencies:** 2 ✓, 5 ⧖

**Priority:** high

**Description:** Implement the chart series processing pipeline that takes raw price data and produces 12-16 normalized points with markers, using SMA smoothing and Ramer-Douglas-Peucker simplification.

**Details:**

Chart series pipeline:
1. Create services/data/series.py module
2. Implement SMA smoothing: 5-day for 1-month range, 20-day for 6-month range
3. Implement Ramer-Douglas-Peucker algorithm to reduce series to 12-16 points while preserving shape
4. Normalize points to [0, 1] range for drawing on palm
5. Identify and mark key points: peak (highest), trough (lowest), end (today)
6. Implement shared scale for comparison mode (two series on same scale)
7. Handle edge cases: flat series (centered flat line), insufficient data points
8. Add narration hints: "up", "down", "barely moved"

Python pseudo-code:
def chart_series(symbol: str, range: str, points: int = 12):
    # 1. Fetch closes from database for range
    closes = db.query(f"SELECT close FROM prices WHERE symbol = '{symbol}' AND ts >= now() - interval '{range}'")
    
    # 2. Apply SMA smoothing
    window = 5 if range == "1m" else 20
    smoothed = moving_average(closes, window)
    
    # 3. Apply RDP to reduce to target points
    simplified = rdp(smoothed, epsilon=auto_epsilon(smoothed, points))
    
    # 4. Normalize to [0, 1]
    min_val, max_val = min(simplified), max(simplified)
    normalized = [(p - min_val) / (max_val - min_val) for p in simplified]
    
    # 5. Find markers
    peak_idx = normalized.index(max(normalized))
    trough_idx = normalized.index(min(normalized))
    
    return {"points": normalized, "markers": {"peak": peak_idx, "trough": trough_idx}}

Comparison mode uses: min(seriesA.min, seriesB.min) and max(seriesA.max, seriesB.max) as shared scale

**Test Strategy:**

Unit test with known series: [1,2,3,4,5,4,3,2,1] should produce rising then falling shape. Verify output has 12-16 points. Verify peak marker at correct index. Test flat series [5,5,5,5,5] produces centered 0.5 values. Test comparison mode produces same scale for both series.
