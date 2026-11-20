# Art Catalogue

A phone app for cataloguing my art collection and the art I like.

- **My collection**: photos, details, purchase and value, frame, notes, certificates and receipts.
- **Liked**: art I've seen and like, with quick capture for exhibitions (paste label text copied with Google Lens).
- **Artists**: biography, documents and all their works.
- **Export**: PDF catalogue with photos (Print → Save as PDF) and a CSV spreadsheet.

All data stays on the phone. There's no server and no account. **Back up** makes one file with
everything (details, photos, documents) and sends it to OneDrive through the share menu.
On the laptop, open the same site and choose **Open backup file** to view the catalogue.

## Install

Open the site in Chrome on Android → ⋮ → **Add to Home screen**.

## Updating

After changing any file, bump `VERSION` in `sw.js` so installed copies pick up the change.
