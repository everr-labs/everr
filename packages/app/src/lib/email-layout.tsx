import {
  Body,
  Button,
  Column,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Img,
  Link,
  Preview,
  pixelBasedPreset,
  Row,
  Section,
  Tailwind,
  Text,
} from "react-email";

interface EmailLayoutProps {
  assetBaseUrl?: string;
  preview: string;
  title: string;
  description: string;
  actionLabel: string;
  actionUrl: string;
  note?: string;
}

function SocialLink({
  assetBaseUrl,
  href,
  icon,
  label,
}: {
  assetBaseUrl: string;
  href: string;
  icon: string;
  label: string;
}) {
  return (
    <Link href={href} className="inline-block pl-4 align-middle">
      <Img
        src={`${assetBaseUrl}/${icon}.png`}
        alt={label}
        width="20"
        height="20"
        className="block"
      />
    </Link>
  );
}

export function EmailLayout({
  assetBaseUrl = "/static",
  preview,
  title,
  description,
  actionLabel,
  actionUrl,
  note,
}: EmailLayoutProps) {
  return (
    <Html lang="en">
      <Tailwind config={{ presets: [pixelBasedPreset] }}>
        <Head />
        <Preview>{preview}</Preview>
        <Body className="m-0 bg-[#0b0b0b] px-3 py-8 font-sans">
          <Container className="mx-auto max-w-[560px]">
            <Section className="mb-8">
              <Row>
                <Column className="w-10">
                  <Img
                    src={`${assetBaseUrl}/everr-mark.png`}
                    alt=""
                    width="32"
                    height="32"
                  />
                </Column>
                <Column>
                  <Text className="m-0 text-[24px] font-bold tracking-tight text-white">
                    Everr
                  </Text>
                </Column>
              </Row>
            </Section>

            <Section className="border border-solid border-[#303030] bg-[#181818] px-7 py-8">
              <Heading
                as="h1"
                className="m-0 text-[30px] font-semibold leading-9 tracking-tight text-white"
              >
                {title}
              </Heading>
              <Text className="mt-5 mb-7 text-[15px] leading-6 text-[#c4c4c4]">
                {description}
              </Text>
              <Button
                href={actionUrl}
                className="box-border inline-block rounded-md bg-[#ddff00] px-6 py-3 text-[14px] font-semibold text-[#111111] no-underline"
              >
                {actionLabel}
              </Button>
              {note && (
                <Text className="mt-7 mb-0 text-[13px] leading-5 text-[#9e9e9e]">
                  {note}
                </Text>
              )}
              <Hr className="my-8 border-[#303030]" />
              <Text className="m-0 text-[12px] leading-5 text-[#9e9e9e]">
                If the button does not work, copy this link into your browser:
              </Text>
              <Link
                href={actionUrl}
                className="break-all text-[12px] leading-5 text-[#ddff00] underline"
              >
                {actionUrl}
              </Link>
            </Section>

            <Section className="mt-6 border-0 border-t border-solid border-[#303030] pt-5">
              <Row>
                <Column>
                  <Text className="m-0 text-[12px] text-[#858585]">
                    Follow Everr
                  </Text>
                </Column>
                <Column className="whitespace-nowrap text-right">
                  <SocialLink
                    assetBaseUrl={assetBaseUrl}
                    href="https://x.com/everrlabs"
                    icon="x"
                    label="X"
                  />
                  <SocialLink
                    assetBaseUrl={assetBaseUrl}
                    href="https://www.linkedin.com/company/everr-labs"
                    icon="linkedin"
                    label="LinkedIn"
                  />
                  <SocialLink
                    assetBaseUrl={assetBaseUrl}
                    href="https://github.com/everr-labs/everr"
                    icon="github"
                    label="GitHub"
                  />
                  <SocialLink
                    assetBaseUrl={assetBaseUrl}
                    href="https://discord.gg/hd6yYDjAuw"
                    icon="discord"
                    label="Discord"
                  />
                </Column>
              </Row>
            </Section>
          </Container>
        </Body>
      </Tailwind>
    </Html>
  );
}
