# Opens a .ods in LibreOffice with a view and prints each sheet's frozen
# panes, which a headless conversion cannot show (it writes no view settings).
# Needs soffice and Python's uno module. Usage: python3 scripts/check-ods-view.py file.ods
# LibreOffice reports a frozen row count one higher than the rows frozen, for
# its own files too.
import os, socket, subprocess, sys, tempfile, time
import uno
from com.sun.star.beans import PropertyValue

path = os.path.abspath(sys.argv[1])
with socket.socket() as s:
    s.bind(('localhost', 0))
    port = s.getsockname()[1]
profile = tempfile.mkdtemp(prefix='pearoffice-lo-')
proc = subprocess.Popen(['soffice', '--headless', '--norestore', '-env:UserInstallation=file://' + profile,
                         '--accept=socket,host=localhost,port=%d;urp;' % port], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
try:
    ctx = None
    for _ in range(120):
        try:
            local = uno.getComponentContext()
            resolver = local.ServiceManager.createInstanceWithContext('com.sun.star.bridge.UnoUrlResolver', local)
            ctx = resolver.resolve('uno:socket,host=localhost,port=%d;urp;StarOffice.ComponentContext' % port)
            break
        except Exception:
            time.sleep(0.5)
    desktop = ctx.ServiceManager.createInstanceWithContext('com.sun.star.frame.Desktop', ctx)
    shown = PropertyValue(); shown.Name = 'Hidden'; shown.Value = False
    doc = desktop.loadComponentFromURL(uno.systemPathToFileUrl(path), '_blank', 0, (shown,))
    c = doc.getCurrentController()
    for sheet in doc.Sheets:
        c.setActiveSheet(sheet)
        print('%s: %s, columns %d, rows %d' % (sheet.Name, 'frozen' if c.hasFrozenPanes() else 'not frozen', c.getSplitColumn(), c.getSplitRow()))
    doc.close(True)
    try:
        desktop.terminate()
    except Exception:
        pass
finally:
    proc.kill()
