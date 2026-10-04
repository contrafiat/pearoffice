// Array functions and spilling (proposals/2026-10-04-spilling-formulas.md):
// each case's whole block is checked against LibreOffice
// (scripts/spill-expectations.js writes test/fixtures/spill-expected.json),
// with Excel's answer recorded by hand in EXCEL_OVERRIDES where they differ.
// Each case sits in column M, SPACING rows below the last, so its spill has
// room. RANDARRAY is left out (random).

const inputs = {
  // A small table: name, team, score, joined (date serial)
  A1: 'Name', B1: 'Team', C1: 'Score', D1: 'Joined',
  A2: 'pear', B2: 'Red', C2: '30', D2: '45292',
  A3: 'Apple', B3: 'Blue', C3: '90', D3: '45300',
  A4: 'fig', B4: 'Red', C4: '60', D4: '45310',
  A5: 'apple', B5: 'Green', C5: '90', D5: '45320',
  A6: 'kiwi', B6: 'Blue', C6: '15', D6: '45330',
  A7: 'Date', B7: 'Red', C7: '75', D7: '45340',
  // A vector and some text to split
  F1: '1', F2: '2', F3: '3', F4: '4', F5: '5', F6: '6', F7: '7',
  H1: 'a,b,c;d,e;f', H2: 'one  two three', H3: 'x-y-z'
}

const formulas = [
  '=SORT(A2:C7)', '=SORT(A2:C7, 3, -1)', '=SORT(A2:C7, {2,3}, {1,-1})', '=SORT(F1:F7, 1, -1)', '=SORT(A1:D1, 1, 1, TRUE)',
  '=SORTBY(A2:A7, C2:C7, -1)', '=SORTBY(A2:B7, B2:B7, 1, C2:C7, -1)',
  '=FILTER(A2:C7, C2:C7>50)', '=FILTER(A2:A7, B2:B7="Red")', '=FILTER(A2:A7, C2:C7>100, "none")', '=FILTER(A2:C7, (B2:B7="Blue")+(C2:C7<20))',
  '=UNIQUE(B2:B7)', '=UNIQUE(A2:A7)', '=UNIQUE(B2:B7, FALSE, TRUE)', '=UNIQUE(C2:C7)',
  '=SEQUENCE(4)', '=SEQUENCE(2, 3)', '=SEQUENCE(3, 2, 10, -2)', '=SEQUENCE(1, 5, 0, 0.5)',
  '=TEXTSPLIT(H1, ",", ";")', '=TEXTSPLIT(H2, " ")', '=TEXTSPLIT(H2, " ", , TRUE)', '=TEXTSPLIT(H1, ",", ";", FALSE, 0, "-")', '=TEXTSPLIT(H3, "-")',
  '=TAKE(A2:C7, 2)', '=TAKE(A2:C7, -2, 2)', '=DROP(A2:C7, 4)', '=DROP(A2:C7, -4, -1)',
  '=VSTACK(A1:B2, F1:F2)', '=HSTACK(A2:A4, F1:F2)',
  '=TOCOL(A2:B3)', '=TOCOL(A2:B3, 0, TRUE)', '=TOROW(F1:F4)',
  '=CHOOSEROWS(A2:C7, 1, -1)', '=CHOOSECOLS(A2:D7, 3, 1)',
  '=WRAPROWS(F1:F7, 3)', '=WRAPROWS(F1:F7, 3, 0)', '=WRAPCOLS(F1:F7, 3, "")',
  '=EXPAND(F1:F2, 3, 2, 0)',
  '=F1:F3*10', '=A2:A4&"!"', '=C2:C7>50', '=F1:F3+TRANSPOSE(F1:F3)',
  '=SUM(SEQUENCE(10))', '=ROWS(FILTER(A2:A7, C2:C7>50))', '=INDEX(SORT(C2:C7), 2)',
  // A2#, the whole spill from a cell above: M151 is SEQUENCE(4), M121 is
  // UNIQUE(A2:A7) and M71 is FILTER(A2:C7, C2:C7>50).
  '=SUM(M151#)', '=SORT(M121#, 1, -1)', '=ROWS(M71#)', '=M151#*2'
]

const SPACING = 10
const cases = formulas.map((f, i) => ['M' + (1 + i * SPACING), f])

// Where LibreOffice's answer (as read back from its .ods) differs from
// Excel's, Excel's block, by formula. LibreOffice writes empty-text results
// as empty cells and TRUE/FALSE results as 1/0 numbers.
const EXCEL_OVERRIDES = {
  '=TEXTSPLIT(H2, " ")': [['one', '', 'two', 'three']],
  '=WRAPCOLS(F1:F7, 3, "")': [[1, 4, 7], [2, 5, ''], [3, 6, '']],
  '=C2:C7>50': [[false], [true], [true], [true], [false], [true]],
  // LibreOffice 26.2 does not read ANCHORARRAY (A2#) from .xlsx (#NAME?).
  '=SUM(M151#)': [[10]],
  '=SORT(M121#, 1, -1)': [['pear'], ['kiwi'], ['fig'], ['Date'], ['Apple']],
  '=ROWS(M71#)': [[4]],
  '=M151#*2': [[2], [4], [6], [8]]
}

module.exports = { inputs, cases, EXCEL_OVERRIDES, SPACING }
