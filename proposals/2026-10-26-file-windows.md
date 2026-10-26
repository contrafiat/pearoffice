# Open a file in its own window (desktop)

**Status:** approved by Tim 2026-10-26, with windows reopened after a restart. A tester works in tabs across several screens and
asked to open documents in a new window (TODO.md, tester feedback
2026-10-26).

**Goal:** on desktop, any file can open in a window of its own, beside the
main window and on another screen.

**Tier:** T1. The desktop shell and the UI only. No change to the worklet,
stored data or the wire format.

## Opening one

- "Open in new window" on a file card's menu, in the side list's menu and in
  an open file's menu (FileBar). A middle click on a card or a side list
  entry does the same.
- The window shows that file's editor only: its toolbar, title and Share,
  with no side list. Its title bar says the file's name.
- One window per file. Opening a file that already has a window brings
  that window forward, from the file list, the side list, a link or @ chip.
  When the main window had the file open, it goes back to the file list, so
  each file is open in one place (presence and cursors are per file and
  device).
- A link or chip in a file window to another file or a folder opens it in
  the main window and brings that forward.
- Windows open a little down and right of the last one, the size of the
  main window.
- **Reopened after a restart** (Tim, 2026-10-26): PearOffice remembers
  which files had windows and where each was (`windows.json` in the data
  folder, this computer only; position, size, maximised, full screen). On
  the next start they open again where they were, once the main window
  shows (a start hidden in the tray waits until it is opened). A window
  that would land off every screen is moved onto the main window's screen.
  A file that is gone (removed, deleted or moved away) gets no window and
  is forgotten. Closing a window forgets it; quitting keeps the list.

## How it works

- `desktop/main.js` keeps a map of file id to window. Worklet events already
  go to every window (the slide show's audience window works this way);
  file windows join that list.
- The UI loads with `?file=<id>` and draws the editor alone (`App.jsx`).
- New calls, desktop only: `app:openWindow { sheetId }` (open or focus) and
  `app:windowFor { sheetId }` (is it open elsewhere; focus it if so). The
  UI checks the second before opening a file in the main window.
- Calls that use the main window today use the window that asked: the PDF
  save dialog and presenting (a show starts from the window it was asked
  from; the presenter view is that window).
- After linking a device or restoring from the phrase, the file windows
  close, since the main window reloads with another identity.
- Closing a file window closes it. Keep running and the tray are about the
  main window, as now. Quitting closes all of them.

## Not in this

- Tabs inside one window.
- Phones and tablets.

## Verify

- Smoke (`app` part or a new `windows` part): open a sheet in a new
  window, type in it and see the edit from the main window's file list
  (title) and a second open; opening it again focuses the same window;
  the main window goes back to the list; a folder link in the file window
  opens in the main window; closing the window; a restart reopening a
  window at its place and a closed one not coming back.
- On Linux by hand on two displays; the Mac and Windows builds through
  their packaged smoke.
- `npm run verify`.

## Rollback

Revert. `windows.json` is left behind and ignored.
