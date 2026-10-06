# PearOffice Documents against Writer, Word and Google Docs: what is missing

2026-10-06. Writer's menu bar (11 menus, 492 entries, read from
`share/config/soffice.cfg/modules/swriter/menubar/menubar.xml` with labels
from `main.xcd` and `writer.xcd`), its standard toolbar (53 items) and its
formatting toolbar (47 items), compared with what Documents v1 plans in
`proposals/2026-10-06-documents.md`. Word (ribbon tabs Home, Insert, Design,
Layout, References, Mailings, Review, View) and Google Docs (menus File,
Edit, View, Insert, Format, Tools, Extensions) are from memory, not checked
against a live copy this time. TipTap extension names are also from memory
of the TipTap 3 docs; ones marked "paid" may have changed licence since.

Each gap has a size (S, M, L) and **P** when it needs a proposal first: it
stores something in the shared file that every device must agree on. For
documents that means almost any new node, mark or attribute, since it
changes the TipTap schema and needs a `meta.version` bump (older devices
then open the file read-only). Several small schema additions are best
batched into one proposal and one version bump.

## What Documents v1 will have

Headings 1 to 3, paragraphs, bold, italic, underline, strikethrough, text
colour, highlight, bulleted, numbered and checklist lists (nested), links,
quotes, code blocks, horizontal lines, tables (no merge), undo and redo of
your own edits, find and replace, word count, live co-editing with
everyone's cursor, import .docx, .md and .txt, export .docx, .md, .txt and
PDF, sharing with roles, devices, seeder. Page-width layout like Google
Docs, built on TipTap 3.

## 1. Everyday gaps (most people hit these in their first hour)

| Gap | Writer | Word | Docs | Size | P |
| --- | --- | --- | --- | --- | --- |
| Paragraph alignment: left, centre, right, justify (`@tiptap/extension-text-align`) | Format > Align Text | Home | Format > Align | S | P |
| Font size and font family (TextStyle kit: `FontSize`, `FontFamily`) | toolbar | Home | toolbar | S | P |
| Clear formatting | Format > Clear | Home | Format > Clear | S | |
| Indent and outdent paragraphs (lists already indent; no core extension for paragraphs) | toolbar | Home | toolbar | S | P |
| Line spacing and space before and after paragraphs (TextStyle `LineHeight`) | Format > Spacing | Home | Format > Line spacing | S | P |
| Superscript and subscript (`extension-subscript`, `extension-superscript`) | Format > Text | Home | Format > Text | S | P |
| Title and subtitle styles; heading levels 4 to 6 (Heading takes `levels`) | Styles menu | styles gallery | Format > Paragraph styles | S | P |
| Paste from Word, Docs and web pages keeping headings, lists, bold and links; paste as plain text | Paste Special | Paste options | Ctrl+Shift+V | M | |
| Smart typing: curly quotes, dashes, "1/2", "(c)" (`extension-typography`); Markdown shortcuts (`# `, `- `, `**`) come with TipTap's input rules | AutoCorrect | AutoCorrect | Tools > Preferences | S | |
| Spell check underlines (system checker in the WebView; check it works on Android and iOS) | Tools > Spelling | Review | Tools > Spelling | S | |
| Print (desktop) and print preview | File > Print | File > Print | File > Print | S | |
| Placeholder text in an empty document (`extension-placeholder`) | no | no | yes | S | |
| Change case: UPPER, lower, Sentence, Title | Format > Text | Home | Format > Text | S | |
| Character count with and without spaces (`extension-character-count`, already used for word count) | Tools > Word Count | Review | Tools > Word count | S | |
| Special characters and emoji (`extension-emoji`) | Insert > Symbol | Insert > Symbol | Insert > Special characters | S | P (emoji node) |
| Keyboard: Ctrl+K link, Ctrl+Alt+1 to 3 headings, Ctrl+Shift+7/8 lists, Ctrl+Enter page break later | yes | yes | yes | S | |

## 2. Common in work documents

| Gap | Writer | Word | Docs | Size | P |
| --- | --- | --- | --- | --- | --- |
| **Images**: insert, resize, align, caption (`extension-image`; blobs and the seeder) | Insert > Image | Insert > Pictures | Insert > Image | L | P |
| Table cell merge and split (Table extension has `mergeCells` and `splitCell`) | Table > Merge Cells | Layout | Format > Table | S | P |
| Table extras: header row, column widths, cell background, borders, sort rows | Table menu | Table Design | Format > Table | M | P |
| Text to table and table to text | Table > Convert | Insert > Table | no | S | |
| Mentions of members (`extension-mention`, from the member list) | no | @mention in comments | @ and smart chips | M | P |
| Date chips and other smart chips (people, files, dropdowns) | no | no | Insert > Smart chips | M | P |
| Collapsible sections (`extension-details`) | Sections | collapse headings | no | S | P |
| Maths: inline and block (`extension-mathematics`, KaTeX) | Insert > Formula Object | Insert > Equation | Insert > Equation | M | P |
| Link previews and editing a link in a small popup | Edit Hyperlink | yes | yes | S | |
| Bookmarks and links to a heading inside the document | Insert > Bookmark | Insert > Bookmark | Insert > Bookmark | M | P |
| Format painter (copy formatting) | toolbar | Home | toolbar | S | |
| List styles: a, i, roman numbers; restart and continue numbering | Format > Lists | Home | Format > Bullets | M | P |
| Export .odt, .html and .epub; import .odt and .html | File > Export | Save As | File > Download | M | |
| Templates: start from a letter, report, meeting notes | File > Templates | New | Template gallery | M | |
| Copy a link to a heading (needs stable ids: `extension-unique-id`) | no | no | yes | S | P |

## 3. Collaboration and review

| Gap | Writer | Word | Docs | Size | P |
| --- | --- | --- | --- | --- | --- |
| **Comments** on a range, replies, resolve (TipTap's is paid; build on Yjs relative positions) | Insert Comment | Review | Insert > Comment | L | P |
| **Suggesting mode / track changes**: accept and reject (TipTap's is paid) | Edit > Track Changes | Review | Suggesting mode | L | P (T3 if roles change) |
| A "commenter" role that can comment and suggest but not edit | no | yes | yes | M | P (T3: roles) |
| Version history: named versions, see and restore an earlier one (TipTap `Snapshot` is paid) | File > Versions | Version history | File > Version history | L | P |
| Who wrote what: author colours on demand | no | no | no | M | P |
| Follow a person's cursor; jump to where someone is | no | no | click avatar | S | |
| Compare two documents | File > Compare | Review > Compare | Tools > Compare | M | |

## 4. Long documents and layout

| Gap | Writer | Word | Docs | Size | P |
| --- | --- | --- | --- | --- | --- |
| Document outline in a side panel (from headings; no schema change) | Navigator | Navigation pane | Document outline | S | |
| Table of contents block that updates (`extension-table-of-contents`) | Insert > Table of Contents | References | Insert > Table of contents | M | P |
| Page view with page breaks, margins, page size, orientation (TipTap `Pages` is paid) | Format > Page Style | Layout | Page setup, pageless off | L | P |
| Headers, footers, page numbers | Insert > Header and Footer | Insert | Insert > Headers | L | P |
| Footnotes and endnotes | Insert > Footnote | References | Insert > Footnote | M | P |
| Columns (two or three) | Format > Columns | Layout | Format > Columns | M | P |
| Heading numbering (1, 1.1, 1.2) | Tools > Heading Numbering | multilevel list | no | M | P |
| Captions and cross-references to figures and tables | Insert > Caption | References | no | M | P |
| Right-to-left paragraphs | toolbar | Home | Format | M | P |
| PDF export that keeps headings as bookmarks and links clickable | Export as PDF | Save as PDF | Download PDF | S | |

## 5. Rarely used or out of scope

| Gap | Writer | Word | Docs | Reason |
| --- | --- | --- | --- | --- |
| Mail merge, envelopes, labels | yes | Mailings | add-on | Needs a data source and printing workflow outside a shared document. |
| Citations and bibliography | yes | References | Tools > Citations | A database of sources; few users, large job. |
| Index (alphabetical, with entries) | yes | References | no | Book production only. |
| Forms and content controls | Form menu | Developer | no | Form filling is a separate product. |
| Macros and extensions | Tools > Macros | yes | Extensions | Runs code from a shared file; a security risk in a P2P app. |
| Shapes, text boxes, frames, Fontwork, drawing | Insert > Shape | Insert > Shapes | Insert > Drawing | Floating layout fights live co-editing. |
| Charts inside a document | Insert > Chart | yes | from Sheets | Wait for linking to a PearOffice sheet. |
| Master documents, sections linked from files | yes | yes | no | Assumes files on one computer. |
| Digital signatures, check-in and check-out, remote files | File menu | yes | no | Assume a server or a single owner. |
| Voice typing | no | Dictate | Tools > Voice typing | The phone keyboards already dictate. |
| Translate, hyphenation, Asian text conversion, phonetic guide | Tools | Review | Tools > Translate | Needs a service or rare language tools. |
| Watermarks, themes, page borders | Format | Design | no | Print styling, low demand. |
| Redaction | Tools > Redact | no | no | Specialist; export-time feature at most. |
| Accessibility checker | Tools | Review | no | Later polish, not a first-year need. |

## Suggested order

1. Alignment, font size and family, line spacing, indent, superscript and
   subscript, title and subtitle: one proposal and one schema bump, all
   ready TipTap extensions.
2. Clear formatting, change case, smart typing, placeholder, character
   count, keyboard shortcuts: small, no proposal.
3. Paste from Word, Docs and the web keeping structure, plus paste as
   plain text.
4. Document outline panel and print.
5. Images (already decided as the first follow-up; needs the 1 MB fix
   proven).
6. Table merge and split, header row and cell colour.
7. Comments, with a commenter role.
8. Suggesting mode.
9. Version history.
10. Page view with headers, footers, page numbers and footnotes, then a
    table of contents.
