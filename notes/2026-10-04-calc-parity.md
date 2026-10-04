# PearSheet against LibreOffice Calc: what is missing

2026-10-04. Calc's menu bar (11 menus, about 420 entries, read from
`share/config/soffice.cfg/modules/scalc/menubar/menubar.xml` with labels from
its registry), its formatting toolbar and its cell menu, compared with
PearSheet's desktop app at main (PR #47).

Each gap has a size (S, M, L) and **P** when it needs a proposal first: it
adds something stored in the shared sheet, so every device must agree on it.

## What PearSheet already has

Cells, formulas (399 functions, spilling, `A2#`, functions over ranges),
tabs (add, rename), insert and delete rows and columns, column widths,
bold, italic, text colour, fill colour, eight number formats, undo and
redo, cut, copy and paste (plain text and within PearSheet), clear,
formula bar with suggestions, zoom (pinch on phones), .xlsx and .csv
import, .xlsx export, sharing with roles, devices, seeder.

## 1. Everyday gaps (most people hit these in their first hour)

| Gap | Calc has | Size | P |
| --- | --- | --- | --- |
| Status bar with Sum, Average and Count of the selection | yes | S | |
| Sort a range (by one or more columns, with or without a header row) | Data > Sort | S | |
| Find and replace (in sheet or all tabs, match case, whole cell) | Edit > Find and Replace | M | |
| Fill handle: drag to copy or continue a series (1, 2, 3; dates; formulas shift their references) | Sheet > Fill Cells, drag handle | M | |
| Delete, move and duplicate tabs; tab colour | Sheet menu | S | P (tab colour, delete) |
| Text alignment (left, centre, right; top, middle, bottom) and wrap text | Format > Align Text, Wrap | S | P |
| Font size, underline, strikethrough | Format > Text, toolbar | S | P |
| More decimal places / fewer, thousands separator, custom format code | toolbar, Format Cells | S | |
| Borders | toolbar, Format Cells | M | P |
| Freeze top rows and first columns | View > Freeze | S | P (shared or per person) |
| Paste special: values only, formats only, transpose | Edit > Paste Special | S | |
| Keyboard: Ctrl+arrows to jump to data edges, Ctrl+Home/End, Ctrl+A, Ctrl+; for today's date, Shift+Space and Ctrl+Space | yes | S | |
| Export .csv and PDF; print (desktop) | File > Export, Print | M | |
| Merge cells | Format > Merge | M | P |
| Row height, hide and show rows and columns, auto-fit column width | Format > Row/Column | M | P |
| Filter (dropdowns on a header row) | Data > AutoFilter | M | P (does filtering hide rows for everyone?) |
| Comments on cells | Insert Comment | M | P |

## 2. Power features worth adding

| Gap | Calc has | Size | P |
| --- | --- | --- | --- |
| **Charts** (section 4) | Insert > Chart | L | P |
| Conditional formatting: rules, colour scales, data bars, icon sets | Format > Conditional | L | P |
| Data validation: dropdown lists, number and date limits | Data > Validity | M | P |
| Named ranges (`=SUM(Sales)`) | Sheet > Named Ranges | M | P |
| Sparklines (tiny charts in a cell) | Insert > Sparkline | M | P |
| Clickable links (HYPERLINK and typed URLs) | Insert > Hyperlink | S | |
| Remove duplicates; text to columns | Data menu | S | |
| Show formulas instead of values; hide gridlines | View menu | S | |
| Pivot tables | Insert > Pivot Table | L | P |
| Group and outline rows (collapse sections) | Data > Group and Outline | M | P |
| Images in a sheet | Insert > Image | L | P (blobs, seeder) |
| Lock ranges so only some people can edit them | Tools > Protect Sheet | L | P (T3: permissions) |
| Goal seek | Tools > Goal Seek | S | |
| Edit history: who changed a cell and when | Edit > Track Changes | L | P |

## 3. Not worth doing

Macros, form controls, OLE objects, shapes and Fontwork, email and
Bluetooth sending, digital signatures, templates manager, scenarios,
solver, streams, XML sources, data providers, external file links, remote
files, check-in/check-out, Data > Statistics wizards (the functions are
there), spelling and thesaurus (the system spell checker covers text
cells), Asian text conversion, page styles and print ranges beyond a simple
"print this tab", Window menu. Most assume one user editing a file on one
computer, or a server PearSheet does not have.

## 4. Charts

What "robust" should cover, in the order to build it:

1. **Types:** column, bar, line, area, pie and doughnut, scatter (XY),
   column-and-line combined. Later: stacked and 100% stacked versions,
   radar, bubble, stock (high-low-close), histogram.
2. **Data:** a range or `A2#` spill, series in rows or columns, first row
   and column as labels, several series, updating live as cells or spills
   change.
3. **Look:** title, axis titles, legend position, data labels, gridlines,
   series colours from the app's palette, axis minimum and maximum, log
   scale, number format of the axis.
4. **Extras:** trend line (linear, with R²), error bars, a secondary axis.
5. **Placement:** a chart floats over the grid, anchored to a cell, can be
   moved and resized; on phones it opens full width.
6. **Files:** export a chart as PNG or SVG. .xlsx export cannot carry charts
   with SheetJS Community Edition (it does not write them), so charts would
   be dropped from .xlsx files unless PearSheet writes the chart XML itself.
   That needs deciding in the proposal.

Questions for the proposal: where a chart lives in the shared sheet (a new
Yjs map of chart specs anchored to cell ids, so it moves with inserted
rows), who may add and edit charts (owners and editors, as for cells), and
which drawing library (ECharts, Apache-2.0, has every type above and draws
to canvas or SVG; Chart.js, MIT, is smaller with fewer types).

## Suggested order

1. Status bar totals, sort, find and replace, keyboard shortcuts, paste
   special, decimals buttons, tab delete and move: all small, none needs a
   proposal.
2. Fill handle and series.
3. One proposal for the next cell formats (alignment, wrap, font size,
   underline, strikethrough, borders) and merged cells, since they all
   extend the same `fmt` map.
4. The charts proposal, then charts.
5. Freeze panes, filter, row height and hiding, then conditional
   formatting and validation.
