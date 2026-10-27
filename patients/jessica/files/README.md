# Jessica — portal files

Drop any file you want the portal to hand to Jessica into this folder:
dosing instructions, protocol PDFs, ritual cards, lab summaries, images.

## Attaching a file to a button

1. Add the file here, e.g. `jessica-dosing-instructions.pdf`
2. Open `../index.html` and find the `PORTAL` config block near the bottom
   (it's marked **✦ EDIT EVERYTHING HERE ✦**).
3. Set that button's `href` to the file path:

   ```js
   {
     id:    "protocol",
     label: "My Protocol",
     href:  "files/jessica-dosing-instructions.pdf"
   }
   ```

4. Commit and redeploy. The button goes live instantly — no other changes.

## Notes

- Paths are relative to `index.html`, so always start with `files/`.
- PDFs and images open in a new tab automatically.
- A button whose `href` is still `""` stays visible and shows a quiet
  "being prepared" note when tapped, so nothing ever looks broken.
- Filenames with no spaces work best: use `-` instead (`my-file.pdf`).
- This portal is marked `noindex` and is not linked from anywhere, but the URL
  is public to anyone who has it — treat it as unlisted, not private, and keep
  clinical detail to what Jessica should receive.
