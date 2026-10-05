# More chart types: radar, bubble, stock, histogram, waterfall

**Status:** approved by Tim 2026-10-05: histogram and waterfall go into
.xlsx in Excel's newer chart format with a plain column chart as fallback. Follows `proposals/2026-10-04-charts.md`,
which picked ECharts partly because it can draw these.

**Goal:** the remaining everyday chart types from Excel and LibreOffice.

**Tier:** T2. A chart's `type` is a shared setting; this adds five values
and two settings. Nothing else in the sheet changes.

## How each one reads its data

Each uses the chart's one data range, like the existing types.

| Type | Data | Drawn as |
| --- | --- | --- |
| Radar | as a column chart: categories down the first column, one series per column | one closed shape per series, a spoke per category |
| Bubble | first column X, then two columns per series: Y and bubble size | circles at (X, Y), area by size |
| Stock | first column dates or labels, then Open, High, Low, Close (exactly four) | candlesticks: green up, red down |
| Histogram | one or more columns of raw values | bars counting values per bin; bins worked out from the values (Scott's rule, as Excel) unless a bin width is set |
| Waterfall | categories and one column of changes | each bar starts where the last ended, rises green, falls red; points marked as totals start from zero |

New settings: `binWidth` (histogram, optional number) and `totals` (waterfall,
the points shown as totals, chosen in the chart panel).

Histogram bins and waterfall running totals are worked out on each device from
the cell values, like the rest of a chart, so every device draws the same.

## Files

- **.xlsx:** radar, bubble and stock are classic Excel chart parts and are
  written and read like the others. Histogram and waterfall exist only in
  Excel's newer chart format, which LibreOffice cannot read. See question 1.
- **PDF and print:** all five, as drawn.

## Compat

Older builds do not know these types and draw them as column charts of the
same range. Nothing is lost: the type and settings stay in the sheet, and the
chart shows correctly again once they update.

## Verify

- `npm run verify` green, plus unit tests for each data shape (bubble pairs,
  stock needing four columns, histogram bins against Excel's for a fixed set,
  waterfall totals) and .xlsx round trips for radar, bubble and stock, checked
  in LibreOffice.
- Desktop smoke: insert each type from the chart panel.
- Emulator: each type drawn on a phone.

## Rollback

Revert. Charts set to the new types show as column charts.

## Decided

1. Histogram and waterfall are written in Excel's newer chart format, with a
   plain column chart of the computed bars as the fallback.
2. Approved as written.
