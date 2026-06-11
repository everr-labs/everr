import type { Integration } from "../types.js";

const MAX_SELECTOR_DEPTH = 4;

export function browserDomIntegration(): Integration {
  let onClick: ((event: MouseEvent) => void) | null = null;
  let onPopState: (() => void) | null = null;
  let originalPushState: typeof history.pushState | null = null;
  let originalReplaceState: typeof history.replaceState | null = null;

  return {
    name: "browserDom",
    setup(client) {
      if (!client.breadcrumbsEnabledFor("dom")) {
        return;
      }

      onClick = (event) => {
        const target = event.target;
        if (!(target instanceof Element)) {
          return;
        }
        client.addBreadcrumb({
          category: "ui.click",
          message: selectorPath(target),
        });
      };
      document.addEventListener("click", onClick, true);

      const recordNavigation = (to: string) => {
        client.addBreadcrumb({ category: "navigation", message: to });
      };

      originalPushState = history.pushState;
      history.pushState = function (...args: Parameters<typeof history.pushState>) {
        const result = originalPushState!.apply(this, args);
        recordNavigation(String(args[2] ?? location.href));
        return result;
      };

      originalReplaceState = history.replaceState;
      history.replaceState = function (
        ...args: Parameters<typeof history.replaceState>
      ) {
        const result = originalReplaceState!.apply(this, args);
        recordNavigation(String(args[2] ?? location.href));
        return result;
      };

      onPopState = () => recordNavigation(location.href);
      window.addEventListener("popstate", onPopState);
    },
    teardown() {
      if (onClick) {
        document.removeEventListener("click", onClick, true);
        onClick = null;
      }
      if (onPopState) {
        window.removeEventListener("popstate", onPopState);
        onPopState = null;
      }
      if (originalPushState) {
        history.pushState = originalPushState;
        originalPushState = null;
      }
      if (originalReplaceState) {
        history.replaceState = originalReplaceState;
        originalReplaceState = null;
      }
    },
  };
}

function selectorPath(element: Element): string {
  const parts: string[] = [];
  let current: Element | null = element;

  while (current && parts.length < MAX_SELECTOR_DEPTH) {
    const tag = current.tagName.toLowerCase();
    if (current.id) {
      parts.unshift(`${tag}#${current.id}`);
      break;
    }

    const className =
      typeof current.className === "string" && current.className.trim()
        ? `.${current.className.trim().split(/\s+/).slice(0, 2).join(".")}`
        : "";
    parts.unshift(`${tag}${className}`);
    current = current.parentElement;
  }

  return parts.join(" > ");
}
