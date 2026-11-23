// Things that work differently in the installed app (Capacitor) than in a browser tab.
import { Capacitor } from '@capacitor/core'

export const isNative = () => Capacitor.isNativePlatform()

const toBase64 = (blob) => new Promise((res, rej) => {
  const r = new FileReader()
  r.onload = () => res(String(r.result).split(',')[1])
  r.onerror = () => rej(r.error)
  r.readAsDataURL(blob)
})

// Excel exports and backups. A browser downloads the file; the app cannot "download", so it
// writes the file to the app's cache and opens the share sheet (Save to Files, Drive, Messenger…).
export async function saveFile(blob, name) {
  if (!isNative()) {
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob); a.download = name
    document.body.appendChild(a); a.click(); a.remove()
    setTimeout(() => URL.revokeObjectURL(a.href), 4000)
    return
  }
  const [{ Filesystem, Directory }, { Share }] = await Promise.all([import('@capacitor/filesystem'), import('@capacitor/share')])
  const { uri } = await Filesystem.writeFile({ path: name, data: await toBase64(blob), directory: Directory.Cache })
  try {
    await Share.share({ title: name, url: uri, dialogTitle: 'Save or send the file' })
  } catch (e) {
    if (!/cancel/i.test(e?.message || '')) throw e          // closing the share sheet is not an error
  }
}
