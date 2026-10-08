// .docx and .xlsx imports check the zip first with the .pptx import's limits
// (checkZip in src/ui/slides/importOoxml.js), so a zip bomb is refused before
// mammoth or SheetJS unpacks it.

const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const JSZip = require('jszip')

const load = () => import(path.join(__dirname, '..', 'src', 'ui', 'slides', 'importOoxml.js'))
const NOT = 'This is not a Word file PearOffice can read.'

async function zipOf (files) {
  const zip = new JSZip()
  for (const [name, data] of Object.entries(files)) zip.file(name, data)
  return Buffer.from(await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' }))
}

// Rewrite the uncompressed size the central directory gives for `name`.
function declare (buf, name, size) {
  for (let i = 0; i < buf.length - 4; i++) {
    if (buf.readUInt32LE(i) !== 0x02014b50) continue
    const nameLen = buf.readUInt16LE(i + 28)
    if (name === '*' || buf.toString('utf8', i + 46, i + 46 + nameLen) === name) buf.writeUInt32LE(size, i + 24)
  }
  return buf
}

test('checkZip passes a normal file and refuses bombs', async () => {
  const { checkZip } = await load()
  await checkZip(await zipOf({ 'word/document.xml': '<w:document/>', 'word/media/a.png': Buffer.alloc(1000) }), NOT)

  await assert.rejects(checkZip(new Uint8Array(100 * 1024 * 1024 + 1), NOT), /too big/)
  await assert.rejects(checkZip(new Uint8Array([1, 2, 3, 4]), NOT), (e) => e.message === NOT)

  // Says it unpacks to 4 GB.
  const big = declare(await zipOf({ 'word/document.xml': '<w:document/>' }), '*', 0xf0000000)
  await assert.rejects(checkZip(new Uint8Array(big), NOT), /unpacks to more|not a Word file/)

  // Says it is small but unpacks to 70 MB.
  const lying = declare(await zipOf({ 'word/document.xml': ' '.repeat(70 * 1024 * 1024) }), 'word/document.xml', 1000)
  await assert.rejects(checkZip(new Uint8Array(lying), NOT), /unpacks to more/)

  // Many parts that are each fine but together unpack past 800 MB.
  const parts = {}
  for (let i = 0; i < 15; i++) parts['xl/worksheets/sheet' + i + '.xml'] = ' '.repeat(55 * 1024 * 1024)
  await assert.rejects(checkZip(new Uint8Array(declare(await zipOf(parts), '*', 1000)), NOT), /unpacks to more/)
})
