// What the formula suggestions show: every function the engine runs, with its
// arguments and one line about it. test/catalog.test.js checks this list
// against the engine. Optional arguments are in [brackets].
//
// Left out because they do not work here: CELL, INFO, PHONETIC, FILTERXML,
// WEBSERVICE and the FORECAST.ETS family.

const LINES = `
ABS|number|Number without its sign
ACOS|number|Arccosine, in radians
ACOSH|number|Inverse hyperbolic cosine
ACOT|number|Arccotangent, in radians
ACOTH|number|Inverse hyperbolic cotangent
ADDRESS|row, column, [abs_num], [a1], [sheet]|Cell address as text, like $C$2
AGGREGATE|function_num, options, ref1, [ref2, ...]|Sum, average, max and more, optionally skipping errors or hidden rows
AND|logical1, [logical2, ...]|TRUE if every argument is TRUE
ARABIC|text|Roman numeral as a number
AREAS|reference|Number of areas in a reference
ASC|text|Full-width letters as half-width
ASIN|number|Arcsine, in radians
ASINH|number|Inverse hyperbolic sine
ATAN|number|Arctangent, in radians
ATAN2|x_num, y_num|Arctangent of the point (x, y), in radians
ATANH|number|Inverse hyperbolic tangent
AVEDEV|number1, [number2, ...]|Average distance of values from their mean
AVERAGE|number1, [number2, ...]|Average of numbers
AVERAGEA|value1, [value2, ...]|Average counting TRUE as 1 and text as 0
AVERAGEIF|range, criteria, [average_range]|Average of cells that meet a condition
AVERAGEIFS|average_range, criteria_range1, criteria1, ...|Average of cells that meet several conditions
BAHTTEXT|number|Number as Thai text with Baht
BASE|number, radix, [min_length]|Number as text in another base
BESSELI|x, n|Modified Bessel function In(x)
BESSELJ|x, n|Bessel function Jn(x)
BESSELK|x, n|Modified Bessel function Kn(x)
BESSELY|x, n|Bessel function Yn(x)
BETA.DIST|x, alpha, beta, cumulative, [a], [b]|Beta distribution
BETA.INV|probability, alpha, beta, [a], [b]|Inverse of the beta distribution
BIN2DEC|number|Binary to decimal
BIN2HEX|number, [places]|Binary to hexadecimal
BIN2OCT|number, [places]|Binary to octal
BINOM.DIST|number_s, trials, probability_s, cumulative|Binomial distribution probability
BINOM.DIST.RANGE|trials, probability_s, number_s, [number_s2]|Probability of a number of successes falling in a range
BINOM.INV|trials, probability_s, alpha|Smallest number of successes whose binomial probability reaches alpha
BITAND|number1, number2|Bitwise AND
BITLSHIFT|number, shift_amount|Shift bits left
BITOR|number1, number2|Bitwise OR
BITRSHIFT|number, shift_amount|Shift bits right
BITXOR|number1, number2|Bitwise exclusive OR
CEILING|number, significance|Round up to a multiple
CEILING.MATH|number, [significance], [mode]|Round up to a multiple, choosing how negatives round
CEILING.PRECISE|number, [significance]|Round up to a multiple, whatever the sign
CHAR|number|Character with this code
CHISQ.DIST|x, deg_freedom, cumulative|Chi-squared distribution
CHISQ.DIST.RT|x, deg_freedom|Right-tailed chi-squared distribution
CHISQ.INV|probability, deg_freedom|Inverse of the chi-squared distribution
CHISQ.INV.RT|probability, deg_freedom|Inverse of the right-tailed chi-squared distribution
CHISQ.TEST|actual_range, expected_range|Chi-squared test of independence
CHOOSE|index_num, value1, [value2, ...]|Pick a value from the list by position
CHOOSECOLS|array, col_num1, [col_num2, ...]|Chosen columns of an array; negative numbers count from the end
CHOOSEROWS|array, row_num1, [row_num2, ...]|Chosen rows of an array; negative numbers count from the end
CLEAN|text|Text without unprintable characters
CODE|text|Code of the first character
COLUMN|[reference]|Column number of a reference
COLUMNS|array|Number of columns
COMBIN|number, number_chosen|Number of combinations
COMBINA|number, number_chosen|Number of combinations with repetition
COMPLEX|real_num, i_num, [suffix]|Complex number from its parts
CONCAT|text1, [text2, ...]|Join text, ranges included
CONCATENATE|text1, [text2, ...]|Join text
CONFIDENCE.NORM|alpha, standard_dev, size|Confidence interval half-width, normal distribution
CONFIDENCE.T|alpha, standard_dev, size|Confidence interval half-width, Student's t
CORREL|array1, array2|Correlation coefficient
COS|number|Cosine of an angle in radians
COSH|number|Hyperbolic cosine
COT|number|Cotangent of an angle in radians
COTH|number|Hyperbolic cotangent
COUNT|value1, [value2, ...]|Count numbers
COUNTA|value1, [value2, ...]|Count cells that are not empty
COUNTBLANK|range|Count empty cells
COUNTIF|range, criteria|Count cells that meet a condition
COUNTIFS|criteria_range1, criteria1, ...|Count cells that meet several conditions
COVARIANCE.P|array1, array2|Covariance of a population
COVARIANCE.S|array1, array2|Covariance of a sample
CSC|number|Cosecant of an angle in radians
CSCH|number|Hyperbolic cosecant
CUMIPMT|rate, nper, pv, start_period, end_period, type|Interest paid between two periods of a loan
CUMPRINC|rate, nper, pv, start_period, end_period, type|Principal paid between two periods of a loan
DATE|year, month, day|Date from year, month and day
DATEDIF|start_date, end_date, unit|Days, months or years between two dates
DATEVALUE|date_text|Date from text
DAVERAGE|database, field, criteria|Average of a field in matching database rows
DAY|date|Day of the month
DAYS|end_date, start_date|Days between two dates
DAYS360|start_date, end_date, [method]|Days between two dates on a 360-day year
DB|cost, salvage, life, period, [month]|Depreciation, fixed-declining balance
DBCS|text|Half-width letters as full-width
DCOUNT|database, field, criteria|Count numbers in a field of matching database rows
DCOUNTA|database, field, criteria|Count filled cells in a field of matching database rows
DDB|cost, salvage, life, period, [factor]|Depreciation, double-declining balance
DEC2BIN|number, [places]|Decimal to binary
DEC2HEX|number, [places]|Decimal to hexadecimal
DEC2OCT|number, [places]|Decimal to octal
DECIMAL|text, radix|Text in another base as a number
DEGREES|angle|Radians to degrees
DELTA|number1, [number2]|1 if two numbers are equal, else 0
DEVSQ|number1, [number2, ...]|Sum of squared distances from the mean
DGET|database, field, criteria|The one value of a field in the matching database row
DMAX|database, field, criteria|Largest value of a field in matching database rows
DMIN|database, field, criteria|Smallest value of a field in matching database rows
DOLLAR|number, [decimals]|Number as currency text
DPRODUCT|database, field, criteria|Product of a field in matching database rows
DROP|array, rows, [columns]|An array without its first rows or columns (negative: the last)
DSTDEV|database, field, criteria|Sample standard deviation of a field in matching database rows
DSTDEVP|database, field, criteria|Population standard deviation of a field in matching database rows
DSUM|database, field, criteria|Sum of a field in matching database rows
DVAR|database, field, criteria|Sample variance of a field in matching database rows
DVARP|database, field, criteria|Population variance of a field in matching database rows
EDATE|start_date, months|Same day some months earlier or later
EFFECT|nominal_rate, npery|Effective annual interest rate
ENCODEURL|text|Text encoded for use in a web address
EOMONTH|start_date, months|Last day of the month some months away
ERF|lower_limit, [upper_limit]|Error function
ERFC|x|Complementary error function
ERROR.TYPE|error_val|Number for the kind of error
EVEN|number|Round up to an even whole number
EXACT|text1, text2|TRUE if two texts match exactly, case included
EXP|number|e raised to a power
EXPAND|array, rows, [columns], [pad_with]|An array grown to a size, filling new cells with pad_with
EXPON.DIST|x, lambda, cumulative|Exponential distribution
F.DIST|x, deg_freedom1, deg_freedom2, cumulative|F distribution
F.DIST.RT|x, deg_freedom1, deg_freedom2|Right-tailed F distribution
F.INV|probability, deg_freedom1, deg_freedom2|Inverse of the F distribution
F.INV.RT|probability, deg_freedom1, deg_freedom2|Inverse of the right-tailed F distribution
F.TEST|array1, array2|F-test of two variances
FACT|number|Factorial
FACTDOUBLE|number|Double factorial
FALSE||The value FALSE
FILTER|array, include, [if_empty]|Rows or columns of an array where include is TRUE
FIND|find_text, within_text, [start_num]|Position of text inside text, case sensitive
FINDB|find_text, within_text, [start_num]|Position of text inside text, case sensitive
FISHER|x|Fisher transformation
FISHERINV|y|Inverse Fisher transformation
FIXED|number, [decimals], [no_commas]|Number as text with fixed decimals
FLOOR|number, significance|Round down to a multiple
FLOOR.MATH|number, [significance], [mode]|Round down to a multiple, choosing how negatives round
FLOOR.PRECISE|number, [significance]|Round down to a multiple, whatever the sign
FORECAST|x, known_ys, known_xs|Value on the straight line through the data
FORECAST.LINEAR|x, known_ys, known_xs|Value on the straight line through the data
FREQUENCY|data_array, bins_array|How many values fall in each bin (first bin shown)
FV|rate, nper, pmt, [pv], [type]|Future value of an investment
GAMMA|number|Gamma function
GAMMA.DIST|x, alpha, beta, cumulative|Gamma distribution
GAMMA.INV|probability, alpha, beta|Inverse of the gamma distribution
GAMMALN|x|Natural log of the gamma function
GAMMALN.PRECISE|x|Natural log of the gamma function
GAUSS|z|Probability a standard normal value lies between 0 and z
GCD|number1, [number2, ...]|Greatest common divisor
GEOMEAN|number1, [number2, ...]|Geometric mean
GESTEP|number, [step]|1 if a number is at least the step, else 0
GROWTH|known_ys, [known_xs], [new_xs], [const]|Value on the exponential curve through the data
HARMEAN|number1, [number2, ...]|Harmonic mean
HEX2BIN|number, [places]|Hexadecimal to binary
HEX2DEC|number|Hexadecimal to decimal
HEX2OCT|number, [places]|Hexadecimal to octal
HLOOKUP|lookup_value, table_array, row_index_num, [range_lookup]|Find a value in the top row and return one from below it
HOUR|time|Hour of a time
HSTACK|array1, [array2, ...]|Arrays side by side
HYPGEOM.DIST|sample_s, number_sample, population_s, number_pop, cumulative|Hypergeometric distribution
IF|logical_test, [value_if_true], [value_if_false]|One value if a test is TRUE, another if not
IFERROR|value, value_if_error|A value, or another if it is an error
IFNA|value, value_if_na|A value, or another if it is #N/A
IFS|logical_test1, value_if_true1, ...|Value for the first test that is TRUE
IMABS|inumber|Size of a complex number
IMAGINARY|inumber|Imaginary part of a complex number
IMARGUMENT|inumber|Angle of a complex number, in radians
IMCONJUGATE|inumber|Complex conjugate
IMCOS|inumber|Cosine of a complex number
IMCOSH|inumber|Hyperbolic cosine of a complex number
IMCOT|inumber|Cotangent of a complex number
IMCSC|inumber|Cosecant of a complex number
IMCSCH|inumber|Hyperbolic cosecant of a complex number
IMDIV|inumber1, inumber2|One complex number divided by another
IMEXP|inumber|e raised to a complex power
IMLN|inumber|Natural log of a complex number
IMLOG10|inumber|Base-10 log of a complex number
IMLOG2|inumber|Base-2 log of a complex number
IMPOWER|inumber, number|Complex number raised to a power
IMPRODUCT|inumber1, [inumber2, ...]|Product of complex numbers
IMREAL|inumber|Real part of a complex number
IMSEC|inumber|Secant of a complex number
IMSECH|inumber|Hyperbolic secant of a complex number
IMSIN|inumber|Sine of a complex number
IMSINH|inumber|Hyperbolic sine of a complex number
IMSQRT|inumber|Square root of a complex number
IMSUB|inumber1, inumber2|One complex number minus another
IMSUM|inumber1, [inumber2, ...]|Sum of complex numbers
IMTAN|inumber|Tangent of a complex number
INDEX|array, row_num, [column_num], [area_num]|Value at a row and column of a range
INDIRECT|ref_text, [a1]|Cell or range named by text, like "B" & 2
INT|number|Round down to a whole number
INTERCEPT|known_ys, known_xs|Where the straight line through the data crosses the y axis
IPMT|rate, per, nper, pv, [fv], [type]|Interest part of one loan payment
IRR|values, [guess]|Internal rate of return
ISBLANK|value|TRUE if the cell is empty
ISERR|value|TRUE if an error other than #N/A
ISERROR|value|TRUE if any error
ISEVEN|number|TRUE if even
ISLOGICAL|value|TRUE if TRUE or FALSE
ISNA|value|TRUE if #N/A
ISNONTEXT|value|TRUE if not text
ISNUMBER|value|TRUE if a number
ISO.CEILING|number, [significance]|Round up to a multiple, whatever the sign
ISODD|number|TRUE if odd
ISOWEEKNUM|date|ISO week number of the year
ISREF|value|TRUE if a reference
ISTEXT|value|TRUE if text
KURT|number1, [number2, ...]|Kurtosis
LARGE|array, k|The k-th largest value
LCM|number1, [number2, ...]|Least common multiple
LEFT|text, [num_chars]|First characters of text
LEFTB|text, [num_bytes]|First characters of text
LEN|text|Number of characters
LENB|text|Number of characters
LINEST|known_ys, [known_xs], [const], [stats]|Slope of the straight line through the data (first value shown)
LN|number|Natural logarithm
LOG|number, [base]|Logarithm, base 10 unless given
LOG10|number|Base-10 logarithm
LOGEST|known_ys, [known_xs], [const], [stats]|Growth factor of the exponential curve through the data (first value shown)
LOGNORM.DIST|x, mean, standard_dev, cumulative|Lognormal distribution
LOGNORM.INV|probability, mean, standard_dev|Inverse of the lognormal distribution
LOOKUP|lookup_value, lookup_vector, [result_vector]|Find a value in a sorted list and return the matching one
LOWER|text|Text in lower case
MATCH|lookup_value, lookup_array, [match_type]|Position of a value in a list
MAX|number1, [number2, ...]|Largest number
MAXA|value1, [value2, ...]|Largest value, counting TRUE as 1
MAXIFS|max_range, criteria_range1, criteria1, ...|Largest value among cells that meet conditions
MDETERM|array|Determinant of a square matrix
MEDIAN|number1, [number2, ...]|Middle value
MID|text, start_num, num_chars|Characters from the middle of text
MIDB|text, start_num, num_bytes|Characters from the middle of text
MIN|number1, [number2, ...]|Smallest number
MINA|value1, [value2, ...]|Smallest value, counting TRUE as 1
MINIFS|min_range, criteria_range1, criteria1, ...|Smallest value among cells that meet conditions
MINUTE|time|Minute of a time
MINVERSE|array|Inverse of a square matrix (first value shown)
MIRR|values, finance_rate, reinvest_rate|Modified internal rate of return
MMULT|array1, array2|Matrix product (first value shown)
MOD|number, divisor|Remainder after division
MODE.MULT|number1, [number2, ...]|Most common values (first shown)
MODE.SNGL|number1, [number2, ...]|Most common value
MONTH|date|Month of a date
MROUND|number, multiple|Round to the nearest multiple
MULTINOMIAL|number1, [number2, ...]|Multinomial coefficient
MUNIT|dimension|Identity matrix (first value shown)
N|value|Value as a number
NA||The #N/A error
NEGBINOM.DIST|number_f, number_s, probability_s, cumulative|Negative binomial distribution
NETWORKDAYS|start_date, end_date, [holidays]|Working days between two dates
NETWORKDAYS.INTL|start_date, end_date, [weekend], [holidays]|Working days between two dates, choosing the weekend
NOMINAL|effect_rate, npery|Nominal annual interest rate
NORM.DIST|x, mean, standard_dev, cumulative|Normal distribution
NORM.INV|probability, mean, standard_dev|Inverse of the normal distribution
NORM.S.DIST|z, cumulative|Standard normal distribution
NORM.S.INV|probability|Inverse of the standard normal distribution
NOT|logical|Reverse TRUE and FALSE
NOW||Current date and time (changes on each device)
NPER|rate, pmt, pv, [fv], [type]|Number of payments for a loan or investment
NPV|rate, value1, [value2, ...]|Net present value of regular cash flows
NUMBERVALUE|text, [decimal_separator], [group_separator]|Number from text, choosing the separators
OCT2BIN|number, [places]|Octal to binary
OCT2DEC|number|Octal to decimal
OCT2HEX|number, [places]|Octal to hexadecimal
ODD|number|Round up to an odd whole number
OFFSET|reference, rows, cols, [height], [width]|Range moved from a starting cell
OR|logical1, [logical2, ...]|TRUE if any argument is TRUE
PEARSON|array1, array2|Pearson correlation coefficient
PERCENTILE.EXC|array, k|k-th percentile, k strictly between 0 and 1
PERCENTILE.INC|array, k|k-th percentile, k from 0 to 1
PERCENTRANK.EXC|array, x, [significance]|Rank of a value as a percentage, exclusive
PERCENTRANK.INC|array, x, [significance]|Rank of a value as a percentage, inclusive
PERMUT|number, number_chosen|Number of permutations
PERMUTATIONA|number, number_chosen|Number of permutations with repetition
PHI|x|Standard normal density
PI||The number pi
PMT|rate, nper, pv, [fv], [type]|Regular payment for a loan
POISSON.DIST|x, mean, cumulative|Poisson distribution
POWER|number, power|Number raised to a power
PPMT|rate, per, nper, pv, [fv], [type]|Principal part of one loan payment
PROB|x_range, prob_range, lower_limit, [upper_limit]|Probability of values falling between two limits
PRODUCT|number1, [number2, ...]|Numbers multiplied together
PROPER|text|Text with each word capitalised
PV|rate, nper, pmt, [fv], [type]|Present value of an investment
QUARTILE.EXC|array, quart|Quartile, exclusive
QUARTILE.INC|array, quart|Quartile, inclusive
QUOTIENT|numerator, denominator|Whole-number part of a division
RADIANS|angle|Degrees to radians
RAND||Random number from 0 to 1 (changes on each device)
RANDARRAY|[rows], [columns], [min], [max], [whole_number]|Block of random numbers, different on each device
RANDBETWEEN|bottom, top|Random whole number in a range (changes on each device)
RANK.AVG|number, ref, [order]|Rank of a number, ties sharing the average rank
RANK.EQ|number, ref, [order]|Rank of a number, ties sharing the top rank
RATE|nper, pmt, pv, [fv], [type], [guess]|Interest rate per period
REPLACE|old_text, start_num, num_chars, new_text|Replace characters at a position
REPLACEB|old_text, start_num, num_bytes, new_text|Replace characters at a position
REPT|text, number_times|Text repeated
RIGHT|text, [num_chars]|Last characters of text
RIGHTB|text, [num_bytes]|Last characters of text
ROMAN|number, [form]|Number as a Roman numeral
ROUND|number, num_digits|Round to some digits
ROUNDDOWN|number, num_digits|Round toward zero
ROUNDUP|number, num_digits|Round away from zero
ROW|[reference]|Row number of a reference
ROWS|array|Number of rows
RSQ|known_ys, known_xs|Square of the correlation coefficient
SEARCH|find_text, within_text, [start_num]|Position of text inside text, ignoring case, with * and ? wildcards
SEARCHB|find_text, within_text, [start_num]|Position of text inside text, ignoring case
SEC|number|Secant of an angle in radians
SECH|number|Hyperbolic secant
SECOND|time|Second of a time
SEQUENCE|rows, [columns], [start], [step]|Block of numbers counting up from start
SERIESSUM|x, n, m, coefficients|Sum of a power series
SIGN|number|1, 0 or -1 for the sign of a number
SIN|number|Sine of an angle in radians
SINH|number|Hyperbolic sine
SKEW|number1, [number2, ...]|Skewness of a sample
SKEW.P|number1, [number2, ...]|Skewness of a population
SLN|cost, salvage, life|Straight-line depreciation
SLOPE|known_ys, known_xs|Slope of the straight line through the data
SMALL|array, k|The k-th smallest value
SORT|array, [sort_index], [sort_order], [by_col]|An array sorted by one of its columns (or rows)
SORTBY|array, by_array1, [sort_order1, ...]|An array sorted by other ranges
SQRT|number|Square root
SQRTPI|number|Square root of a number times pi
STANDARDIZE|x, mean, standard_dev|How many standard deviations a value is from the mean
STDEV|number1, [number2, ...]|Standard deviation of a sample
STDEV.P|number1, [number2, ...]|Standard deviation of a population
STDEV.S|number1, [number2, ...]|Standard deviation of a sample
STDEVA|value1, [value2, ...]|Standard deviation of a sample, counting TRUE as 1
STDEVPA|value1, [value2, ...]|Standard deviation of a population, counting TRUE as 1
STEYX|known_ys, known_xs|Standard error of the straight-line fit
SUBSTITUTE|text, old_text, new_text, [instance_num]|Replace matching text
SUBTOTAL|function_num, ref1, [ref2, ...]|Sum, average, count and more, by number
SUM|number1, [number2, ...]|Add numbers
SUMIF|range, criteria, [sum_range]|Add cells that meet a condition
SUMIFS|sum_range, criteria_range1, criteria1, ...|Add cells that meet several conditions
SUMPRODUCT|array1, [array2, ...]|Sum of the products of matching values
SUMSQ|number1, [number2, ...]|Sum of squares
SUMX2MY2|array_x, array_y|Sum of x squared minus y squared
SUMX2PY2|array_x, array_y|Sum of x squared plus y squared
SUMXMY2|array_x, array_y|Sum of the squared differences
SWITCH|expression, value1, result1, ..., [default]|Result for the first value that matches
SYD|cost, salvage, life, per|Sum-of-years'-digits depreciation
T|value|Text if the value is text, else empty
T.DIST|x, deg_freedom, cumulative|Student's t distribution
T.DIST.2T|x, deg_freedom|Two-tailed Student's t distribution
T.DIST.RT|x, deg_freedom|Right-tailed Student's t distribution
T.INV|probability, deg_freedom|Inverse of Student's t distribution
T.INV.2T|probability, deg_freedom|Two-tailed inverse of Student's t distribution
T.TEST|array1, array2, tails, type|Student's t-test probability
TAKE|array, rows, [columns]|The first rows or columns of an array (negative: the last)
TAN|number|Tangent of an angle in radians
TANH|number|Hyperbolic tangent
TEXT|value, format_text|Number as text in a format, like "0.00"
TEXTAFTER|text, delimiter, [instance_num], [match_mode], [match_end], [if_not_found]|Text after a delimiter
TEXTBEFORE|text, delimiter, [instance_num], [match_mode], [match_end], [if_not_found]|Text before a delimiter
TEXTJOIN|delimiter, ignore_empty, text1, [text2, ...]|Join text with a delimiter
TEXTSPLIT|text, col_delimiter, [row_delimiter], [ignore_empty], [match_mode], [pad_with]|Text split into cells across and down
TIME|hour, minute, second|Time from hour, minute and second
TIMEVALUE|time_text|Time from text
TOCOL|array, [ignore], [scan_by_column]|An array as one column
TODAY||Today's date (changes on each device)
TOROW|array, [ignore], [scan_by_column]|An array as one row
TRANSPOSE|array|Rows and columns swapped (first value shown)
TREND|known_ys, [known_xs], [new_xs], [const]|Value on the straight line through the data
TRIM|text|Text without extra spaces
TRIMMEAN|array, percent|Mean leaving out a share of the highest and lowest values
TRUE||The value TRUE
TRUNC|number, [num_digits]|Cut off decimals without rounding
TYPE|value|Number for the kind of value
UNICHAR|number|Character with this Unicode number
UNICODE|text|Unicode number of the first character
UNIQUE|array, [by_col], [exactly_once]|An array with repeated rows (or columns) left out
UPPER|text|Text in upper case
VALUE|text|Number from text
VAR|number1, [number2, ...]|Variance of a sample
VAR.P|number1, [number2, ...]|Variance of a population
VAR.S|number1, [number2, ...]|Variance of a sample
VARA|value1, [value2, ...]|Variance of a sample, counting TRUE as 1
VARPA|value1, [value2, ...]|Variance of a population, counting TRUE as 1
VLOOKUP|lookup_value, table_array, col_index_num, [range_lookup]|Find a value in the first column and return one from its row
VSTACK|array1, [array2, ...]|Arrays one below another
WEEKDAY|date, [return_type]|Day of the week as a number
WEEKNUM|date, [return_type]|Week number of the year
WEIBULL.DIST|x, alpha, beta, cumulative|Weibull distribution
WORKDAY|start_date, days, [holidays]|Date some working days away
WORKDAY.INTL|start_date, days, [weekend], [holidays]|Date some working days away, choosing the weekend
WRAPCOLS|vector, wrap_count, [pad_with]|A row or column wrapped into columns of a given length
WRAPROWS|vector, wrap_count, [pad_with]|A row or column wrapped into rows of a given length
XIRR|values, dates, [guess]|Internal rate of return for cash flows on given dates
XLOOKUP|lookup_value, lookup_array, return_array, [if_not_found], [match_mode], [search_mode]|Find a value and return the matching one from another range
XMATCH|lookup_value, lookup_array, [match_mode], [search_mode]|Position of a value in a list, with more ways to match
XNPV|rate, values, dates|Net present value of cash flows on given dates
XOR|logical1, [logical2, ...]|TRUE if an odd number of arguments are TRUE
YEAR|date|Year of a date
YEARFRAC|start_date, end_date, [basis]|Fraction of a year between two dates
Z.TEST|array, x, [sigma]|One-tailed z-test probability
`

const FUNCTIONS = LINES.trim().split('\n').map((line) => {
  const [name, args, about] = line.split('|')
  return { name, args, about }
})

// Up to `limit` functions for what has been typed: names that start with it
// first, then names that contain it.
function suggest (typed, limit = 8) {
  const q = String(typed || '').toUpperCase()
  if (!q) return []
  const starts = []
  const contains = []
  for (const f of FUNCTIONS) {
    if (f.name.startsWith(q)) starts.push(f)
    else if (q.length >= 2 && f.name.includes(q)) contains.push(f)
  }
  return starts.concat(contains).slice(0, limit)
}

const byName = new Map(FUNCTIONS.map((f) => [f.name, f]))
function lookup (name) {
  return byName.get(String(name || '').toUpperCase()) || null
}

module.exports = { FUNCTIONS, suggest, lookup }
