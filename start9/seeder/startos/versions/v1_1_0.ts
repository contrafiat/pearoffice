import { IMPOSSIBLE, VersionInfo } from '@start9labs/start-sdk'

export const v1_1_0 = VersionInfo.of({
  version: '1.1.0:0',
  releaseNotes: {
    en_US: "New Features. Spreadsheets in .ods. Open and save LibreOffice spreadsheets with their formulas, charts, formatting, column widths, frozen rows and columns, colour rules and data validation. A filter saved in the file comes in too. Documents in .odt. Open and save LibreOffice documents with their headings, lists, checklists, tables, pictures, links and text formatting. Slides in .odp. Open and save LibreOffice Impress presentations with their text, shapes, lines and arrows, pictures, charts and...",
  },
  migrations: {
    up: async ({ effects }) => {},
    down: IMPOSSIBLE,
  },
})
