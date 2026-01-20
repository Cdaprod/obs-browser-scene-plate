# Site Assets & Overlay Standardization

This directory hosts the browser UI (`index.html`) and the static plates/overlays served to OBS Browser Sources.
To keep overlays predictable (and to make the URL builder populate query params automatically), follow the
standardization checklist below.

## Overlay Standardization Checklist

1. **Match the filename and the documented default URL**
   * The `Default URL` comment is parsed by the UI to prefill query params.
   * The URL must match the file name exactly (including spelling such as `analogue_*`).

2. **Put the full default URL on a single line**
   * Use the exact label `Default URL (full params):` so the parser can find it.
   * Include all query params on the same line as the URL so they are picked up by the UI.
   * Example:
     ```
     * Default URL (full params):
     *  http://<HOST_IP>:8789/overlays/example_overlay.html?alpha=0.2&speed=1.0
     ```

3. **Preserve URL parameter semantics**
   * Query params are the UI contract. Do not rename or remove params without updating the overlay code and docs.
   * Use `<HOST_IP>` in the documented URL so the UI can substitute the active host.

4. **Keep overlays transparent and full-frame**
   * Use `html, body { height: 100%; margin: 0; background: transparent; }`.
   * Anchor your root container to the viewport (`position: absolute; inset: 0;`).

5. **Document parameters clearly**
   * List ranges and defaults after the default URL block.
   * If a parameter toggles a feature, specify the accepted values (e.g. `0|1`).

## Usage & Tests

* Serve the site and open `http://<HOST_IP>:8789/` to verify the URL builder output.
* Basic URL helper tests:
  ```sh
  node --test site/url-utils.test.js
  ```
