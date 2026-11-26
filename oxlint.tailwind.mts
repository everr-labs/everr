// Tailwind compiles `group-has-*` to a `:has()` that styles any descendant,
// `*`. With one such rule in the global stylesheet, Chrome restyles the whole
// page whenever an element is added anywhere, about 20ms on a busy page.
const groupHas = /\bgroup-has-/;

interface StringNode {
  type: string;
  value?: unknown;
}

interface RuleContext {
  report(descriptor: { node: StringNode; messageId: string }): void;
}

export default {
  meta: { name: "tailwind" },
  rules: {
    "no-group-has": {
      meta: {
        type: "problem",
        messages: {
          groupHas:
            "Tailwind's group-has variants make every DOM change restyle the whole page. Target the element itself: [[data-slot=x]:has(...)_&]:class.",
        },
        schema: [],
      },
      create(context: RuleContext) {
        const check = (node: StringNode, text: unknown) => {
          if (typeof text === "string" && groupHas.test(text))
            context.report({ node, messageId: "groupHas" });
        };
        return {
          Literal: (node: StringNode) => check(node, node.value),
          TemplateElement: (node: StringNode & { value: { raw: string } }) =>
            check(node, node.value.raw),
        };
      },
    },
  },
};
