Keep the bundle size minimal and measure the gz size at each meanungful iteration.

MUST follow the oTel semconv when available.
Custom attrs should be under everr. prefix

example: 
 - browser.web_vital.ttfb.request_duration isn't standard, so it should be everr.browser.web_vital.ttfb.request_duration
 - browser.web_vital.value is standard and should not be prefixed
