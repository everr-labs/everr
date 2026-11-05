# Legal documents: remaining work

The Terms, privacy notice, and DPA in `packages/docs/content/legal/` are drafts.
Complete these items before offering them for acceptance or relying on their
commitments.

- [ ] Set the effective dates, governing law, and courts. Review the business-only
      Terms, including pricing, cancellation, notice, and liability, against the
      service and Polar checkout.
- [ ] Decide how customers, including existing customers, receive and accept the
      Terms and DPA. Keep dated copies of the versions presented.
- [ ] Verify that customer telemetry can be returned or deleted when required,
      including downstream copies and restored backups. Normal retention expiry
      alone does not establish the DPA's return and deletion procedure.
- [ ] Complete the DPA's processing details and subprocessor list. Verify supplier
      contracts, actual processing locations, and international transfer safeguards.
      This includes Brevo's contracting entity and arrangements: production
      telemetry showed CRM synchronization enabled on November 2, 2026.
- [ ] Put a PostHog DPA in place: the operator confirmed none has been signed.
      PostHog says its public DPA is a preview and directs customers to generate
      and sign the agreement in their organization. Verify its applicable
      subprocessor and transfer arrangements before finalizing the notice.
- [ ] Verify the agreements and contracting entities for Scaleway, ClickHouse,
      Brevo, and Polar against the actual accounts. Deployment configuration
      selects Scaleway Paris and ClickHouse on AWS Frankfurt; ClickHouse also
      lists support and control-plane processing in other locations.
- [ ] Confirm retention and deletion procedures for accounts, organizations,
      Brevo records, support, analytics, security logs, billing records, and
      backups. Update the privacy notice with periods or specific criteria.
- [ ] Confirm the live analytics and browser storage configuration, lawful bases,
      and any consent requirements. Update the privacy notice and controls to match.
      The website config uses PostHog cookieless mode and in-memory Everr browser
      identifiers. The app switches to in-memory identifiers when analytics storage
      is declined, but does not stop sending browser telemetry. Verify PostHog's
      server-side settings and assess the actual data collected in both cases.
      Make sure the app's Analytics switch accurately describes what it controls.
- [ ] Verify the DPA's security commitments, including access controls, encryption,
      tenant isolation, backups, incident response, and assistance with requests.
- [ ] Confirm any marketing or other uses of personal data, and establish procedures
      for privacy requests and breach response.
- [ ] Review the finalized documents with Portuguese counsel, remove draft notices,
      and publish only when the stated obligations can be met.
