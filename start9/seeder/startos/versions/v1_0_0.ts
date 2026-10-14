import { IMPOSSIBLE, VersionInfo } from '@start9labs/start-sdk'

export const v1_0_0 = VersionInfo.of({
  version: '1.0.0:0',
  releaseNotes: {
    en_US: "New Features. Folders. Sort your files into folders. Drag a file onto a folder, or press and hold it on a phone. Your folders are the same on all your devices and come back with your recovery phrase. Click cells while typing a formula. Type = or =SUM( and click a cell, or drag across a range, to put it in the formula, as in Excel. Print with Ctrl+P (Cmd+P on a Mac) in any open file on desktop. Phones buzz gently when you tap a button.",
  },
  migrations: {
    up: async ({ effects }) => {},
    down: IMPOSSIBLE,
  },
})
