# 004: Session replay under GDPR and the ePrivacy Directive

Status: research complete (2026-07-21)

Note: this is legal-adjacent research compiled for product planning from regulator and vendor sources. It is not legal advice. The central CNIL text is a draft recommendation under public consultation (closed 22 April 2026); the final version may change details but the consent analysis rests on settled law.

## Verdict

There is no defensible way to run session replay on a strictly cookieless, bannerless marketing homepage for EU visitors. Three independent lines close every escape route:

1. The ePrivacy consent gate applies even without cookies. The EDPB's Guidelines 2/2023 on the technical scope of Article 5(3) hold that JavaScript instructing the browser to send information (user input, locally produced data, hashed or fingerprint-style identifiers) is "gaining access" to the terminal equipment, that storage with no minimum duration counts (even caching or RAM), and that information typed by the user is "stored" on the terminal before collection ([EDPB Guidelines 2/2023, paras 32-34, 37, 44, 50, 62-63](https://www.edpb.europa.eu/system/files/2024-10/edpb_guidelines_202302_technical_scope_art_53_eprivacydirective_v2_en_0.pdf)). A replay recorder that ships DOM mutations and input events to a server is in scope regardless of whether it sets a cookie.
2. Legitimate interest cannot substitute for that consent. Where Article 5(3) ePrivacy applies, it is lex specialis over GDPR Article 6, so a controller cannot swap in legitimate interest for the storage/access operation ([EDPB Opinion 5/2019 on the ePrivacy/GDPR interplay](https://www.edpb.europa.eu/sites/default/files/files/file1/201905_edpb_opinion_eprivacydir_gdpr_interplay_en_0.pdf)).
3. The CNIL has now said this explicitly for replay. Its February 2026 draft recommendation states that "the purposes pursued by the deployment of session replay tools are subject to the prior consent of users" because the operations are neither exclusively for enabling communication nor strictly necessary for the service (draft, para 19, [PDF](https://www.cnil.fr/sites/default/files/2026-02/recommendation_draft_session_replay.pdf); [announcement](https://www.cnil.fr/en/session-replay-cnil-launches-public-consultation-its-draft-recommendation)). The audience measurement exemption does not extend to replay: the exemption's permitted purposes are audience measurement and A/B testing only ([CNIL sheet 16](https://www.cnil.fr/en/sheet-ndeg16-use-analytics-your-websites-and-applications)).

The vendors agree in practice: PostHog's own cookieless mode disables session replay for non-consenting users ([PostHog cookieless tracking tutorial](https://posthog.com/tutorials/cookieless-tracking)), and Sentry documents initializing the replay SDK only after consent ([Sentry, Protecting User Privacy in Session Replay](https://docs.sentry.io/security-legal-pii/scrubbing/protecting-user-privacy/)).

The defensible bannerless configuration is: no replay on the homepage at all, with only consent-exempt aggregate audience measurement (which itself must meet strict CNIL conditions). A consented mode is workable but must gate SDK initialization on opt-in and meet the masking, identifier, sampling, retention, and rights requirements detailed below.

## 1. Consent versus legitimate interest: two legal layers

Session replay triggers two distinct legal tests, and both matter:

- Layer 1 (ePrivacy Article 5(3), transposed in France as Article 82 of the Data Protection Act): storing information on, or reading information from, the user's terminal requires consent unless the operation is (a) solely for carrying out the transmission of a communication or (b) strictly necessary for a service the user explicitly requested ([EDPB Guidelines 2/2023, para 1 and fn 4](https://www.edpb.europa.eu/system/files/2024-10/edpb_guidelines_202302_technical_scope_art_53_eprivacydirective_v2_en_0.pdf)). The CNIL draft finds replay fails both exemptions: replay operations "are not exclusively intended to enable or facilitate electronic communication" and "are not strictly necessary for the provision of the services offered by publishers, as these services could be provided without them" (draft, para 19).
- Layer 2 (GDPR Article 6, for the "subsequent processing" of the collected data): in principle any Article 6 basis could apply, but the CNIL states "consent is generally the most appropriate legal basis for this subsequent processing" (draft, paras 28-29). And critically, Layer 2 never rescues Layer 1: per EDPB Opinion 5/2019, where Article 5(3) requires consent, the controller cannot rely on legitimate interest for the storage/access operation ([EDPB Opinion 5/2019](https://www.edpb.europa.eu/sites/default/files/files/file1/201905_edpb_opinion_eprivacydir_gdpr_interplay_en_0.pdf)).

So the recurring vendor-marketing claim that "cookieless replay with masking can run on legitimate interest" collapses at Layer 1. The legitimate interest debate is only relevant to what you do with lawfully collected recordings, not to whether you may record.

The CNIL draft also notes replay tools "enable the collection of data that directly or indirectly identifies users, regardless of their configuration and settings," so GDPR applies to the recordings in all configurations (draft, para 7).

## 2. Why cookieless does not escape ePrivacy

The EDPB Guidelines 2/2023 were written precisely to shut down "alternative solutions for tracking internet users" that "circumvent the legal obligations" of Article 5(3) (para 3). The load-bearing findings for replay:

- "Information" is broader than personal data; even non-personal data on the terminal is protected (paras 7-12, citing Planet49, CJEU C-673/17).
- Gaining access: "Whenever an entity takes steps towards gaining access to information stored in the terminal equipment, Article 5(3) ePD would apply... JavaScript code, where the accessing entity instructs the browser of the user to send asynchronous requests with the targeted information. Such access clearly falls within the scope of Article 5(3) ePD" (paras 32-33). A replay SDK is exactly this.
- No persistence threshold: "The ePD does not place any upper or lower limit on the length of time that information must persist" and RAM and CPU cache are in scope (paras 37-38). Caching alone is storage "even if this storage is not permanent" (para 50).
- User-typed content: "the fact that information is being entered by the user would not preclude the application of Article 5(3) ePD with regards to storage, as this information is stored temporarily on the terminal equipment before being collected" (para 62). This covers keystroke and form capture, the core of replay.
- Local processing and fingerprinting: locally produced information (including from browser APIs) triggers Article 5(3) the moment it "or any derivation of this information" leaves the device (paras 44, 52-53). Client-side hashed identifiers used to identify a person are a "gaining of access" (paras 61-63). Fingerprint-based session stitching is therefore inside the consent gate, not a way around it.
- The CNIL draft mirrors this: replay tools "rely on trackers (which may be cookies in the context of the web, or other technologies...)" (draft, para 8), and its recommended identifier schemes (random session IDs, pseudonymous hashes, domain-limited identifiers, paras 44 I1-I3) are all treated as within the consent-gated regime, not exemptions from it.

Practical reading: even a replay implementation with zero cookies, zero localStorage, and per-session random IDs still needs prior consent for EU users, because the recording itself is the regulated access.

## 3. The audience measurement exemption and why replay is outside it

The exemption is a national interpretation of "strictly necessary" tolerated by the CNIL (and a few other DPAs), not an EU-wide right. CNIL conditions ([sheet 16](https://www.cnil.fr/en/sheet-ndeg16-use-analytics-your-websites-and-applications)):

- purposes limited to audience measurement and A/B testing, for the publisher alone
- users informed, with the ability to object
- no cross-referencing with other processing (customer files, other sites' statistics)
- scope limited to a single site or publisher
- truncation of the last byte of the IP address
- tracker lifetime capped at 13 months

The CNIL also warns that "most large audience measurement offerings do not fall within the scope of the exemption, regardless of their configuration" (same page). Secondary sources consistently report an additional 25-month cap on retention of the collected data under the CNIL's exempt-analytics program ([ppc.land](https://ppc.land/french-data-regulator-updates-cookie-exemption-rules-for-websites/), [Adobe technote](https://experienceleague.adobe.com/en/docs/analytics/technotes/privacy/cnil-consent-exemption)).

Replay does not fit: session replay purposes (error diagnosis, UX improvement, support) are not on the exemption's purpose list, and the CNIL draft explicitly frames replay as "an alternative to more traditional measures (e.g. audience measurement or analytics tools)" while requiring prior consent for all replay purposes (draft, paras 2, 15, 19). Secondary commentary reads the CNIL the same way: heatmaps and session recordings are outside the consent-exempt analytics scope ([Kukie](https://kukie.io/blog/hotjar-cookie-consent-privacy), [Clifford Chance](https://www.cliffordchance.com/insights/resources/blogs/talking-tech/en/articles/2026/03/session-replay-tools-under-scrutiny--cnil-launches-public-consul.html)). Note also that the UK ICO accepts no analytics exemption at all under PECR, so even aggregate analytics needs consent for UK visitors ([Luxgap comparison](https://luxgap.com/articles/cookies-analytics-exemption-cnil-cnpd-consentement-ico-2026?lang=en)).

## 4. Masking and redaction expectations

The CNIL draft (paras 43, 48 and the boxed note on Article 25 GDPR) sets the expected bar for tooling:

- A masking tool must be available "to automatically and manually select the data that should not be made available, in particular images, forms, text fields and dynamically filled fields (e.g. containing account information). In the absence of configuration, masking should apply by default to all categories considered" (measure M0). Masking-by-default is the baseline, not an option.
- Publishers should be able to choose the consequence of masking: collection with unmasking restricted to authorized users plus an internal validation process (M1), collection encrypted provider-side with justified access requests (M2), or no collection at all (M3).
- Security measures: "Blocking the collection of any passwords, banking information, or other data subject to special conditions of collection and storage" (S1) and a role-based authorization policy with periodic review (S2).
- Providers should "always offer the most protective default settings possible, in accordance with Data protection by default (Article 25 of the GDPR)."
- Unmasking is expected to be exceptional: for support, the CNIL recommends validating unmasking with the user before doing it; for UX purposes it sees unmasking as "of very marginal use" (Appendix 1).

## 5. Retention limits

Storage limitation (GDPR Article 5(1)(e)) applied to replay, per the CNIL draft (paras 45-47 and Appendix 1):

- Support and assistance: "retention period limited to a few hours after the end of the session."
- UX improvement and error/technical diagnosis: "a few months," scoped to the current version of the site, with documented justification.
- Providers must let publishers configure retention and deletion rules per purpose, and must implement "a technical architecture that allows individual sessions to be deleted."
- Collection itself should be limited: random sampling (L1), trigger-based recording with prompt deletion when no trigger occurred (L2), and deletion of sessions found unnecessary for the purpose (L3) (para 42 and following).

## 6. Data subject rights over recordings

- Recordings are personal data, so Articles 15 to 20 apply in full: access, rectification, erasure, restriction, portability. Controllers "must facilitate the exercise of these rights by providing users with user-friendly and comprehensible mechanisms, such as a rights management centre" (draft, para 33).
- Consent withdrawal must be as easy as giving it and must be technically effective: previously set trackers must stop being read (expiring cookies server-side, deleting client-side storage via script) (draft, paras 34-35).
- Individual-session deletion capability is required to honor erasure requests (draft, para 47).
- Proof of consent must be demonstrable at any time; where publisher and provider are joint controllers for the collection, the contract must allocate consent-collection duties, evidence provision, and audit terms (draft, boxed "Proof of consent" section).
- Roles: the publisher is generally controller; the provider is processor, but becomes an independent controller for its own reuse (for example product improvement) and joint controller with the publisher for the read/write operations feeding that reuse, per the Fashion ID case law (draft, paras 10-12). This matters when picking a vendor whose terms allow training or product improvement on customer recordings.

## 7. DPA guidance and enforcement landscape

- CNIL: the draft recommendation on session replay tools was published for consultation until 22 April 2026 and will be adopted in final form afterwards ([CNIL announcement](https://www.cnil.fr/en/session-replay-cnil-launches-public-consultation-its-draft-recommendation), [draft PDF](https://www.cnil.fr/sites/default/files/2026-02/recommendation_draft_session_replay.pdf)). It builds on the CNIL's binding 2020 guidelines and recommendation on cookies and other trackers (deliberations 2020-091 and 2020-092, cited in the draft's footnotes).
- EDPB: Guidelines 2/2023 (final version adopted October 2024) settle the cookieless question; Opinion 5/2019 settles the no-legitimate-interest question (links above).
- Replay-specific EU fines: none widely documented as of July 2026; the regulatory posture so far is guidance plus the CNIL's long track record of tracker-consent enforcement, which is what a bannerless deployment would collide with ([Clifford Chance](https://www.cliffordchance.com/insights/resources/blogs/talking-tech/en/articles/2026/03/session-replay-tools-under-scrutiny--cnil-launches-public-consul.html), [ppc.land](https://ppc.land/frances-cnil-puts-session-replay-tools-under-the-privacy-microscope/)).
- Adjacent risk: Sentry flags "an increase in lawsuits under U.S. state wiretapping laws" over session replay and recommends assessing whether to obtain consent even outside the EU ([Sentry privacy doc](https://docs.sentry.io/security-legal-pii/scrubbing/protecting-user-privacy/)).

## 8. Vendor positioning survey

### PostHog

- Masking defaults: input elements are masked by default ("highly likely to contain sensitive text such as email or password"); general text is not masked by default and requires opt-in configuration; masked data "is never sent over the network to PostHog" ([privacy controls doc](https://posthog.com/docs/session-replay/privacy)).
- Consent stance: the GDPR doc recommends explicit consent for product tracking and a cookie banner for logged-out website tracking, plus EU Cloud hosting for GDPR-sensitive deployments ([GDPR doc](https://posthog.com/docs/privacy/gdpr-compliance)). Integration with CMPs goes through opt-in/opt-out controls ([data collection doc](https://posthog.com/docs/privacy/data-collection)).
- Cookieless mode: uses a daily-salted server-side hash of team, IP, user agent, and hostname instead of client storage. Decisive for this ticket: in cookieless operation "session replay and surveys... are disabled if the user has not given cookie consent." The `on_reject` pattern (full tracking after consent, cookieless fallback on reject) still requires a banner ([cookieless tutorial](https://posthog.com/tutorials/cookieless-tracking)).

### Sentry

- Masking defaults are the strictest of the three, all on by default: `maskAllText: true`, `blockAllMedia: true` (img, svg, video, object, picture, embed, map, audio), `maskAllInputs: true`; since SDK v8 the `unmask`/`unblock` lists default to empty ([privacy configuration](https://docs.sentry.io/platforms/javascript/session-replay/privacy/)).
- "The Session Replay SDK in its default configuration redacts all HTML text nodes and images before it leaves the browser"; keypresses masked, mouse paths reduced to endpoints ([protecting user privacy](https://docs.sentry.io/security-legal-pii/scrubbing/protecting-user-privacy/)).
- Consent stance: users are "responsible for providing appropriate notices"; Sentry documents lazy-loading the replay integration only after consent, offers server-side scrubbing (credit cards, SSNs, tokens) and deletion of individual replays post-ingestion, and covers replay under its DPA (same doc).

### Highlight.io

- Three modes via `privacySetting`: `strict` (obfuscates all text and images, non-reversible, client-side), `default` (the default value: obfuscates all inputs plus text matching PII regexes such as emails, phone numbers, SSNs, credit cards, addresses, IPs; images not obfuscated), and `none` ([privacy doc](https://www.highlight.io/docs/getting-started/client-sdk/replay-configuration/privacy), [default privacy mode announcement](https://www.highlight.io/blog/default-privacy-mode)).
- Element-level controls: `highlight-ignore` class to drop an input's contents, `data-hl-record="true"` to whitelist over-redacted text.
- Consent stance: the replay privacy docs carry no consent or GDPR guidance; compliance framing lives in general legal pages. Weakest of the three on consent positioning.

Cross-vendor takeaway: all three treat masking as a client-side, pre-transmission control (good: masked data never reaches the vendor), but their defaults differ materially. Sentry masks everything by default; Highlight masks inputs plus regex-detected PII; PostHog masks inputs only, leaving page text visible unless configured. None of them claims replay can run consent-free in the EU, and PostHog's product behavior actively prevents it in cookieless mode.

## Decision inputs

Realistic options for the homepage, in descending order of defensibility:

1. No replay on the bannerless homepage. Keep the homepage strictly cookieless with, at most, consent-exempt aggregate audience measurement configured to the CNIL conditions (single-site scope, IP truncation, 13-month tracker lifetime, no cross-referencing, user info and objection). Run replay only on surfaces that already have a CMP (the app, docs if ever gated). Zero replay signal from the homepage is the price.
2. Consent-gated replay behind a CMP on the homepage. Ship the replay SDK only after opt-in; non-consenting visitors get cookieless analytics. This abandons "bannerless" (valid consent requires an affirmative act, so some consent UI must exist) and marketing homepages see low opt-in rates, so replay coverage will be a biased sample. If chosen, the consented mode must provide: SDK initialization strictly after consent; purpose-level consent labels in the CMP matching the CNIL wording (error detection, UX improvement, support); masking on by default for inputs, forms, images, and dynamic fields with an allowlist workflow; password and payment blocking that cannot be disabled; random per-session or pseudonymous domain-limited identifiers; sampling or trigger-based capture; purpose-based retention (hours for support, few months for UX/errors); per-session deletion; effective consent withdrawal that stops capture and clears client state; consent receipts/proof; and a DPA that bars vendor reuse of recordings or, if reuse exists, a joint-controllership arrangement.
3. Trigger-scoped consented capture. A narrower variant of option 2: no ambient recording; capture only after an explicit in-context action (for example a "report a problem" widget that asks permission to record the session going forward). Maps cleanly to the CNIL's support purpose (retention of a few hours) and its L2 trigger-based collection measure. Smallest legal surface that still yields replay data from the homepage.
4. Cookieless replay without consent, relying on masking and legitimate interest. Not defensible for EU traffic. The EDPB guidelines put cookieless capture inside Article 5(3), EDPB Opinion 5/2019 blocks the legitimate interest substitution, and the CNIL draft states replay purposes require prior consent regardless of configuration. Choosing this is accepting a known compliance gap in the CNIL's currently spotlighted enforcement area, not a gray zone.

Vendor-selection input: if a consented mode is built, Sentry's defaults (mask all text, block all media, consent-gated lazy init, per-replay deletion) are closest to the CNIL draft's M0/S1 expectations out of the box; PostHog requires adding text masking config but has the most explicit consent integration guidance and EU hosting; Highlight's default mode leaves non-PII page text visible and its docs offer no consent guidance.
