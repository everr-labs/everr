---
"@everr/app": patch
---

The app's JavaScript and CSS files are now served compressed with brotli or gzip, prepared once when the app is built. Browsers download about a quarter of the bytes on a first visit, and self-hosted installations get this without configuring compression in their reverse proxy.
