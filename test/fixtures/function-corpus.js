// One or more cases for (nearly) every function the formula engine has.
// Expected values come from LibreOffice (scripts/function-expectations.js
// writes test/fixtures/function-expected.json), with Excel's answer recorded
// by hand in EXCEL_OVERRIDES where the two disagree. Left out: functions
// that depend on the clock, randomness, the network or the system locale
// (NOW, TODAY, RAND, RANDBETWEEN, WEBSERVICE, FILTERXML, INFO, CELL,
// PHONETIC, ASC, DBCS, BAHTTEXT) and the FORECAST.ETS family (LibreOffice
// implements a different algorithm).

const inputs = {
  // Two numeric series, text, paired numbers, dates, cash flows.
  A1: '2', A2: '4', A3: '4', A4: '5', A5: '7', A6: '9', A7: '10', A8: '12', A9: '15', A10: '20', A12: 'TRUE',
  B1: '1.5', B2: '3.2', B3: '3.9', B4: '5.1', B5: '6.8', B6: '9.4', B7: '9.9', B8: '12.2', B9: '14.7', B10: '19.5',
  C1: 'apple', C2: 'Banana', C3: 'cherry', C4: 'apple', C5: 'date', C6: 'Elder',
  D1: '10', D2: '20', D3: '30', D4: '40', D5: '50', D6: '60',
  E1: '45292', E2: '45351', E3: '45383', E4: '0.75', E5: '45657',
  F1: '45306',
  G1: '-1000', G2: '300', G3: '400', G4: '500',
  K1: '4', L1: '7', K2: '2', L2: '6',
  M1: '1', M2: '2', M3: '3', N1: '0.2', N2: '0.5', N3: '0.3',
  O1: '5', O2: '10',
  // A 4x4 matrix
  Q1: '2', R1: '-1', S1: '0', T1: '3', Q2: '1', R2: '3', S2: '2', T2: '-2', Q3: '0', R3: '1', S3: '4', T3: '1', Q4: '5', R4: '2', S4: '-3', T4: '2',
  // A small database and two criteria blocks
  V1: 'Tree', W1: 'Height', X1: 'Profit',
  V2: 'Apple', W2: '18', X2: '105', V3: 'Pear', W3: '12', X3: '96', V4: 'Cherry', W4: '13', X4: '105',
  V5: 'Apple', W5: '14', X5: '75', V6: 'Pear', W6: '9', X6: '76.8', V7: 'Apple', W7: '8', X7: '45',
  Z1: 'Tree', AA1: 'Height', Z2: 'Apple', AA2: '>10', Z4: 'Tree', Z5: 'Pear', Z6: 'Cherry',
  // Text for TEXTBEFORE / TEXTAFTER and a date column for XNPV / XIRR
  AF1: 'Tree', AF2: 'Cherry',
  AC1: "Red riding hood's, red hood", AD1: '45292', AD2: '45351', AD3: '45383', AD4: '45657'
}

const formulas = [
  // Maths and trigonometry
  '=ABS(-3.5)', '=ACOS(0.5)', '=ACOSH(2)', '=ACOT(2)', '=ACOTH(3)', '=ARABIC("MCMXCIV")', '=ASIN(0.5)', '=ASINH(1)',
  '=ATAN(1)', '=ATAN2(1, 2)', '=ATANH(0.5)', '=BASE(255, 16, 4)', '=CEILING(4.3, 2)', '=CEILING.MATH(-4.3, 2)',
  '=CEILING.PRECISE(4.3, 2)', '=COMBIN(8, 3)', '=COMBINA(4, 3)', '=COS(1)', '=COSH(1)', '=COT(1)', '=COTH(1)', '=CSC(1)',
  '=CSCH(1)', '=DECIMAL("FF", 16)', '=DEGREES(PI())', '=EVEN(3.2)', '=EXP(2)', '=FACT(6)', '=FACTDOUBLE(7)',
  '=FLOOR(4.7, 2)', '=FLOOR.MATH(-4.7, 2)', '=FLOOR.PRECISE(4.7, 2)', '=GCD(24, 36, 60)', '=INT(-3.7)',
  '=ISO.CEILING(4.3, 2)', '=LCM(4, 6, 10)', '=LN(5)', '=LOG(8, 2)', '=LOG10(1000)', '=MDETERM(K1:L2)',
  '=INDEX(MINVERSE(K1:L2), 1, 1)', '=SUM(MMULT(K1:L2, K1:L2))', '=MOD(10, 3)', '=MOD(-10, 3)', '=MROUND(10, 3)',
  '=MULTINOMIAL(2, 3, 4)', '=SUM(MUNIT(3))', '=ODD(2.1)', '=PI()', '=POWER(2, 10)', '=PRODUCT(A1:A4)', '=QUOTIENT(17, 5)',
  '=RADIANS(180)', '=ROMAN(1994)', '=ROUND(2.567, 2)', '=ROUND(-2.5, 0)', '=ROUNDDOWN(-2.567, 1)', '=ROUNDUP(2.561, 2)',
  '=SEC(1)', '=SECH(1)', '=SERIESSUM(2, 0, 1, M1:M3)', '=SIGN(-2)', '=SIN(2)', '=SINH(1)', '=SQRT(16)', '=SQRTPI(2)',
  '=SUBTOTAL(9, A1:A10)', '=SUBTOTAL(1, A1:A10)', '=AGGREGATE(14, 6, A1:A10, 2)', '=SUM(A1:A10)', '=SUMIF(A1:A10, ">5")',
  '=SUMIFS(D1:D6, C1:C6, "apple")', '=SUMPRODUCT(A1:A3, B1:B3)', '=SUMSQ(A1:A4)', '=SUMX2MY2(A1:A4, B1:B4)',
  '=SUMX2PY2(A1:A4, B1:B4)', '=SUMXMY2(A1:A4, B1:B4)', '=TAN(1)', '=TANH(0.5)', '=TRUNC(-8.97, 1)',

  // Statistics
  '=AVEDEV(A1:A10)', '=AVERAGE(A1:A10)', '=AVERAGEA(A1:A12)', '=AVERAGEIF(A1:A10, ">5")',
  '=AVERAGEIFS(D1:D6, C1:C6, "apple")', '=BETA.DIST(0.4, 2, 3, TRUE)', '=BETA.INV(0.5, 2, 3)',
  '=BINOM.DIST(3, 10, 0.4, FALSE)', '=BINOM.DIST.RANGE(10, 0.4, 3, 5)', '=BINOM.INV(10, 0.4, 0.5)',
  '=CHISQ.DIST(3, 4, TRUE)', '=CHISQ.DIST.RT(3, 4)', '=CHISQ.INV(0.5, 4)', '=CHISQ.INV.RT(0.5, 4)',
  '=CHISQ.TEST(A1:A5, B1:B5)', '=CONFIDENCE.NORM(0.05, 2.5, 50)', '=CONFIDENCE.T(0.05, 2.5, 50)',
  '=CORREL(A1:A10, B1:B10)', '=COUNT(A1:A12)', '=COUNTIF(C1:C6, "apple")', '=COUNTIFS(C1:C6, "apple", D1:D6, ">15")',
  '=COVARIANCE.P(A1:A10, B1:B10)', '=COVARIANCE.S(A1:A10, B1:B10)', '=DEVSQ(A1:A10)', '=EXPON.DIST(1, 2, TRUE)',
  '=F.DIST(2, 3, 4, TRUE)', '=F.DIST.RT(2, 3, 4)', '=F.INV(0.5, 3, 4)', '=F.INV.RT(0.5, 3, 4)', '=F.TEST(A1:A10, B1:B10)',
  '=FISHER(0.5)', '=FISHERINV(0.5)', '=FORECAST(11, B1:B10, A1:A10)', '=FORECAST.LINEAR(11, B1:B10, A1:A10)',
  '=INDEX(FREQUENCY(A1:A10, O1:O2), 2, 1)', '=GAMMA(5.5)', '=GAMMA.DIST(2, 3, 2, TRUE)', '=GAMMA.INV(0.5, 3, 2)',
  '=GAMMALN(10)', '=GAMMALN.PRECISE(10)', '=GAUSS(1)', '=GEOMEAN(A1:A10)', '=INDEX(GROWTH(B1:B10, A1:A10, 21), 1, 1)',
  '=HARMEAN(A1:A10)', '=HYPGEOM.DIST(1, 4, 8, 20, FALSE)', '=INTERCEPT(B1:B10, A1:A10)', '=KURT(A1:A10)',
  '=LARGE(A1:A10, 2)', '=INDEX(LINEST(B1:B10, A1:A10), 1, 1)', '=INDEX(LOGEST(B1:B10, A1:A10), 1, 1)',
  '=LOGNORM.DIST(4, 1, 0.5, TRUE)', '=LOGNORM.INV(0.5, 1, 0.5)', '=MAX(A1:A10)', '=MAXA(A1:A12)',
  '=MAXIFS(D1:D6, C1:C6, "apple")', '=MEDIAN(A1:A10)', '=MIN(A1:A10)', '=MINA(A1:A12)', '=MINIFS(D1:D6, C1:C6, "apple")',
  '=INDEX(MODE.MULT(A1:A10), 1, 1)', '=MODE.SNGL(A1:A10)', '=NEGBINOM.DIST(3, 5, 0.4, FALSE)', '=NORM.DIST(1, 0, 1, TRUE)',
  '=NORM.INV(0.9, 0, 1)', '=NORM.S.DIST(1, TRUE)', '=NORM.S.INV(0.9)', '=PEARSON(A1:A10, B1:B10)',
  '=PERCENTILE.EXC(A1:A10, 0.25)', '=PERCENTILE.INC(A1:A10, 0.25)', '=PERCENTRANK.EXC(A1:A10, 7)',
  '=PERCENTRANK.INC(A1:A10, 7)', '=PERMUT(8, 3)', '=PERMUTATIONA(4, 3)', '=PHI(0.5)', '=POISSON.DIST(3, 2.5, FALSE)',
  '=PROB(M1:M3, N1:N3, 1, 2)', '=QUARTILE.EXC(A1:A10, 1)', '=QUARTILE.INC(A1:A10, 1)', '=RANK.AVG(4, A1:A10)',
  '=RANK.EQ(4, A1:A10)', '=RSQ(B1:B10, A1:A10)', '=SKEW(A1:A10)', '=SKEW.P(A1:A10)', '=SLOPE(B1:B10, A1:A10)',
  '=SMALL(A1:A10, 3)', '=STANDARDIZE(5, 7, 2)', '=STDEV(A1:A10)', '=STDEV.P(A1:A10)', '=STDEV.S(A1:A10)',
  '=STDEVA(A1:A12)', '=STDEVPA(A1:A12)', '=STEYX(B1:B10, A1:A10)', '=T.DIST(1.5, 10, TRUE)', '=T.DIST.2T(1.5, 10)',
  '=T.DIST.RT(1.5, 10)', '=T.INV(0.9, 10)', '=T.INV.2T(0.1, 10)', '=T.TEST(A1:A10, B1:B10, 2, 1)',
  '=INDEX(TREND(B1:B10, A1:A10, 21), 1, 1)', '=TRIMMEAN(A1:A10, 0.2)', '=VAR(A1:A10)', '=VAR.P(A1:A10)',
  '=VAR.S(A1:A10)', '=VARA(A1:A12)', '=VARPA(A1:A12)', '=WEIBULL.DIST(2, 1.5, 3, TRUE)', '=Z.TEST(A1:A10, 8)',

  // Engineering
  '=BESSELI(1.5, 1)', '=BESSELJ(1.9, 2)', '=BESSELK(1.5, 1)', '=BESSELY(2.5, 1)', '=BIN2DEC("1100100")',
  '=BIN2HEX("11111011", 4)', '=BIN2OCT("1001")', '=BITAND(13, 25)', '=BITLSHIFT(4, 2)', '=BITOR(23, 10)',
  '=BITRSHIFT(13, 2)', '=BITXOR(5, 3)', '=COMPLEX(3, 4)', '=DEC2BIN(9, 4)', '=DEC2HEX(100, 4)', '=DEC2OCT(58)',
  '=DELTA(5, 5)', '=ERF(1)', '=ERFC(1)', '=GESTEP(5, 4)', '=HEX2BIN("F", 8)', '=HEX2DEC("A5")', '=HEX2OCT("F")',
  '=IMABS("3+4i")', '=IMAGINARY("3+4i")', '=IMARGUMENT("3+4i")', '=IMCONJUGATE("3+4i")', '=IMCOS("1+i")',
  '=IMCOSH("1+i")', '=IMCOT("1+i")', '=IMCSC("1+i")', '=IMCSCH("1+i")', '=IMDIV("-238+240i", "10+24i")',
  '=IMEXP("1+i")', '=IMLN("3+4i")', '=IMLOG10("3+4i")', '=IMLOG2("3+4i")', '=IMPOWER("2+3i", 3)',
  '=IMPRODUCT("3+4i", "5-3i")', '=IMREAL("6-9i")', '=IMSEC("1+i")', '=IMSECH("1+i")', '=IMSIN("1+i")',
  '=IMSINH("1+i")', '=IMSQRT("1+i")', '=IMSUB("13+4i", "5+3i")', '=IMSUM("3+4i", "5-3i")', '=IMTAN("1+i")',
  '=OCT2BIN("3", 3)', '=OCT2DEC("54")', '=OCT2HEX("100", 4)',

  // Dates and times
  '=DATE(2024, 2, 30)', '=DATEDIF(E1, E3, "M")', '=DATEVALUE("2024-07-04")', '=DAY(E2)', '=DAYS(E3, E1)',
  '=DAYS360(E1, E3)', '=EDATE(E1, 3)', '=EOMONTH(E2, 2)', '=HOUR(E4)', '=ISOWEEKNUM(E3)', '=MINUTE(TIME(12, 15, 30))',
  '=MONTH(E3)', '=NETWORKDAYS(E1, E3, F1)', '=NETWORKDAYS.INTL(E1, E3, 11)', '=SECOND(TIME(12, 15, 30))',
  '=TIME(18, 30, 0)', '=TIMEVALUE("18:30")', '=WEEKDAY(E3, 2)', '=WEEKNUM(E3, 2)', '=WORKDAY(E1, 30, F1)',
  '=WORKDAY.INTL(E1, 30, 11)', '=YEAR(E5)', '=YEARFRAC(E1, E5, 1)', '=YEARFRAC(E1, E3)',

  // Money
  '=FV(0.05/12, 36, -300)', '=IPMT(0.05/12, 1, 36, 10000)', '=IRR(G1:G4)', '=NPER(0.05/12, -200, 10000)',
  '=NPV(0.08, G2:G4)', '=PMT(0.05/12, 36, 10000)', '=PPMT(0.05/12, 1, 36, 10000)', '=PV(0.05/12, 36, -300)',
  '=RATE(36, -300, 10000)',

  // Information and logic
  '=ERROR.TYPE(1/0)', '=ISBLANK(A11)', '=ISERR(NA())', '=ISERROR(1/0)', '=ISEVEN(4)', '=ISLOGICAL(A12)', '=ISNA(NA())',
  '=ISNONTEXT(A1)', '=ISNUMBER(C1)', '=ISREF(A1)', '=ISTEXT(C1)', '=N(A12)', '=NA()', '=TYPE(C1)', '=AREAS(A1:B2)',
  '=AND(TRUE, A1>1)', '=FALSE()', '=IF(A1>5, "big", "small")', '=IFERROR(1/0, "x")', '=IFNA(NA(), "x")',
  '=IFS(A1>5, "big", TRUE, "small")', '=NOT(FALSE)', '=OR(FALSE, A1>1)', '=SWITCH(2, 1, "one", 2, "two")', '=TRUE()',
  '=XOR(TRUE, FALSE, TRUE)',

  // Lookup and reference
  '=ADDRESS(2, 3)', '=ADDRESS(2, 3, 4)', '=CHOOSE(2, "a", "b", "c")', '=COLUMN(C5)', '=COLUMNS(A1:D1)',
  '=HLOOKUP(4, K1:L2, 2, FALSE)', '=INDEX(A1:B10, 3, 2)', '=MATCH(7, A1:A10, 0)', '=ROW(B7)', '=ROWS(A1:A10)',
  '=SUM(TRANSPOSE(A1:A3))', '=VLOOKUP("cherry", C1:D6, 2, FALSE)',

  // Text
  '=CHAR(65)', '=CLEAN("a"&CHAR(7)&"b")', '=CODE("A")', '=CONCAT(C1, "-", C2)', '=CONCATENATE("a", "b")',
  '=DOLLAR(1234.567, 2)', '=EXACT("a", "A")', '=FIND("an", C2)', '=FINDB("an", C2)', '=FIXED(1234.567, 1)',
  '=LEFT(C2, 3)', '=LEFTB(C2, 3)', '=LEN(C3)', '=LENB(C3)', '=LOWER(C2)', '=MID(C3, 2, 3)', '=MIDB(C3, 2, 3)',
  '=NUMBERVALUE("1.234,5", ",", ".")', '=PROPER("hello wORLD")', '=REPLACE("abcdef", 2, 3, "X")',
  '=REPLACEB("abcdef", 2, 3, "X")', '=REPT("ab", 3)', '=RIGHT(C3, 2)', '=RIGHTB(C3, 2)', '=SEARCH("AN", C2)',
  '=SEARCHB("AN", C2)', '=SUBSTITUTE("a-b-c", "-", "+")', '=T(C1)', '=TEXT(1234.5, "#,##0.00")',
  '=TEXTJOIN(", ", TRUE, C1:C3)', '=TRIM("  a  b  ")', '=UNICHAR(9731)', '=UNICODE("A")', '=UPPER(C1)',
  '=ENCODEURL("a b&c")',

  // Added with the formulajs fills
  '=COUNTA(A1:A12)', '=COUNTBLANK(A1:A12)', '=ISODD(3)', '=VALUE("12.5")', '=LOOKUP(7, A1:A10, B1:B10)',
  '=SLN(10000, 1000, 5)', '=SYD(10000, 1000, 5, 2)', '=DB(10000, 1000, 5, 2)', '=DDB(10000, 1000, 5, 2)',
  '=EFFECT(0.05, 12)', '=NOMINAL(0.05, 12)', '=CUMIPMT(0.05/12, 36, 10000, 1, 12, 0)',
  '=CUMPRINC(0.05/12, 36, 10000, 1, 12, 0)', '=MIRR(G1:G4, 0.1, 0.12)', '=SUBTOTAL(109, A1:A10)',
  '=TRIM("lead and  inner  spaces ")', '=SEARCH("b*n", C2)', '=TRUNC(PI(), 3)',
  '=MDETERM(Q1:T4)', '=INDEX(MINVERSE(Q1:T4), 2, 3)', '=SUMPRODUCT(Q1:T1, Q2:T2)', '=T.TEST(A1:A10, B1:B10, 2, 2)',
  '=T.TEST(A1:A10, B1:B10, 1, 3)', '=INDEX(LINEST(B1:B10, A1:A10), 1, 2)', '=INDEX(LOGEST(B1:B10, A1:A10), 1, 2)',
  '=IMDIV("1+2i", "3-4i")', '=COMPLEX(0, -1)',

  // Newer functions (src/sheet/formula/newer.js)
  '=XLOOKUP("cherry", C1:C6, D1:D6)', '=XLOOKUP("fig", C1:C6, D1:D6, "none")', '=XLOOKUP(11, A1:A10, B1:B10, , -1)',
  '=XLOOKUP(11, A1:A10, B1:B10, , 1)', '=XLOOKUP("apple", C1:C6, D1:D6, , 0, -1)', '=XLOOKUP("b*", C1:C6, D1:D6, , 2)',
  '=XLOOKUP(7, K1:L1, K2:L2)', '=XMATCH("date", C1:C6)', '=XMATCH(11, A1:A10, 1)', '=XMATCH("apple", C1:C6, 0, -1)',
  '=TEXTBEFORE(AC1, "hood")', '=TEXTBEFORE(AC1, "HOOD", 1, 1)', '=TEXTAFTER(AC1, "red ", -1)', '=TEXTAFTER(AC1, ",")',
  '=TEXTBEFORE(AC1, "x", 1, 0, 0, "-")', '=TEXTAFTER(AC1, "hood", 2)',
  '=SUM(OFFSET(A1, 2, 0, 3, 1))', '=OFFSET(C1, 2, 1)', '=SUM(OFFSET(A1:B2, 1, 0))', '=INDIRECT("C3")', '=SUM(INDIRECT("A1:A" & A2))',
  '=INDIRECT("R2C4", FALSE)', '=XNPV(0.09, G1:G4, AD1:AD4)', '=XIRR(G1:G4, AD1:AD4)',
  '=DSUM(V1:X7, "Profit", Z1:AA2)', '=DAVERAGE(V1:X7, 3, Z4:Z5)', '=DCOUNT(V1:X7, "Height", Z1:AA2)', '=DCOUNTA(V1:X7, "Tree", Z4:Z6)',
  '=DGET(V1:X7, "Profit", AF1:AF2)', '=DGET(V1:X7, "Profit", Z4:Z5)', '=DMAX(V1:X7, "Profit", Z4:Z6)', '=DMIN(V1:X7, "Height", Z1:AA2)', '=DPRODUCT(V1:X7, "Height", Z4:Z5)',
  '=DSTDEV(V1:X7, "Profit", Z1:Z2)', '=DSTDEVP(V1:X7, "Profit", Z1:Z2)', '=DVAR(V1:X7, "Profit", Z1:Z2)', '=DVARP(V1:X7, "Profit", Z1:Z2)'
]

// Where LibreOffice is wrong or cannot answer, Excel's value, and why.
const EXCEL_OVERRIDES = {
  '=COUNT(A1:A12)': [10, 'Excel does not count a TRUE typed into a cell; LibreOffice does'],
  '=PERCENTRANK.EXC(A1:A10, 7)': [0.454, 'Excel rounds down to the given digits (its PERCENTRANK.INC docs example returns 0.666); LibreOffice rounds'],
  '=BESSELJ(1.9, 2)': [0.329925829, 'value from Excel\'s BESSELJ docs example; LibreOffice differs in the 7th digit'],
  '=BINOM.DIST.RANGE(10, 0.4, 3, 5)': [0.6664716288, 'LibreOffice does not read this function from .xlsx; worked out by hand'],
  '=NETWORKDAYS.INTL(E1, E3, 11)': [79, 'LibreOffice does not read this function from .xlsx; counted by hand (Sundays off)'],
  '=WORKDAY.INTL(E1, 30, 11)': [45327, 'LibreOffice does not read this function from .xlsx; counted by hand (2024-02-05)'],
  '=TEXTAFTER(AC1, "hood", 2)': ['', 'empty text; LibreOffice\'s file reads back as a blank cell'],
  '=DGET(V1:X7, "Profit", Z4:Z5)': [{ error: '#NUM!' }, 'Excel\'s DGET gives #NUM! for more than one match; LibreOffice uses its own Err:502']
}

// Laid out in column H, one per row.
const cases = formulas.map((f, i) => ['H' + (i + 1), f])

module.exports = { inputs, cases, EXCEL_OVERRIDES }
