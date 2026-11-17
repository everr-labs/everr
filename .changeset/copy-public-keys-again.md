---
"@everr/app": minor
---

Public keys can now be copied again after creation: each row in the **Public keys** section of the API keys page has a **Copy key** button, and clicking the key's prefix shows the full key. A key with more than two allowed origins now lists them all when you click its **+N**. Public keys created before this release can't be shown again, because only a hash of them was stored. To get a copyable one, create a new public key and replace the old one in your frontend config. Secret keys are still shown only once.

API keys can no longer be created or changed through the raw `/api/auth/api-key/create` and `/api/auth/api-key/update` endpoints. Use the API keys page, which validates a public key's allowed origins.
