import type { ImageObj } from './types'

/**
 * The change that swaps a picture for another file: the new picture is scaled to FIT the place the old one had (centred, never
 * stretched, never spilling over the text around it). That place is the object's `slot`: the area the original picture of the page
 * covered, or - for a picture the user added - the box it had when first replaced.
 */
export async function replacementPatch(o: ImageObj, file: File, addAsset: (bytes: Uint8Array, mime: 'image/png' | 'image/jpeg') => string): Promise<Partial<ImageObj> | string> {
  const mime = file.type === 'image/jpeg' ? 'image/jpeg' : file.type === 'image/png' ? 'image/png' : null
  if (!mime) return 'Choose a PNG or JPEG image.'
  const bytes = new Uint8Array(await file.arrayBuffer())
  const bmp = await createImageBitmap(file).catch(() => null)
  const assetId = addAsset(bytes, mime)
  const slot = o.slot ?? { x: o.x, y: o.y, w: o.w, h: o.h }
  if (!bmp) return { assetId, slot }
  const k = Math.min(slot.w / bmp.width, slot.h / bmp.height)
  const w = bmp.width * k
  const h = bmp.height * k
  return { assetId, slot, keepAspect: true, x: slot.x + (slot.w - w) / 2, y: slot.y + (slot.h - h) / 2, w, h }
}
