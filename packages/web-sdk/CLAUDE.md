Keep the bundle size minimal and measure the gz size at each meanungful iteration.

Write the last size snapshot here to track it.

Current size:  8,012 B gz (core + web-vitals attribution build + native error capture at ~430 B after dropping scrub and cause-chain rendering by decision, plus a pre-init console.warn; captureReactError lives in the ./react entry and tree-shakes out of the core; ceiling 9KB)
