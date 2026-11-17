# Adding or fixing a website

Built-in websites live in `extension/presets.js`. Each entry has:

- `host` – a pattern for the website's address.
- `profile` – `"custom"` for most sites (or `"royalroad"`).
- `picks.txt_publish / txt_draft / txt_schedule` – the exact button names on the site.
- `steps` – extra clicks, such as pressing "New Chapter" first. `ifFilled: true` means "only when the editor already has text".
- `noSite: true` – the site has no schedule feature.
- `blankRequired: true` – never type into an editor that still shows an old chapter.
- `titleTpl` – e.g. `"{name}"` when the site adds the chapter number itself.

## How to find the values
1. Open the site's Add-chapter page, choose it as the Target tab, press **Test target**.
2. Use the extension's **Extra buttons to click** and the button-name boxes until one chapter saves as a draft.
3. Press **Copy this website's settings** and paste the result in an issue (or turn it into a `presets.js` entry).

## Please
- Test with a draft first. Never test on a story that is not yours.
- Describe what you tested and the website's date.
