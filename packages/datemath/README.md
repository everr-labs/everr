# @everr/datemath

Elasticsearch-compatible date math expression parser and evaluator.

## Installation

```bash
pnpm add @everr/datemath
```

## Quick start

```ts
import { resolve, isValid } from "@everr/datemath";

// "1 hour ago, rounded down to the start of the hour"
const date = resolve("now-1h/h");

// Validate before resolving
if (isValid("now-7d/d")) {
  const weekAgo = resolve("now-7d/d");
}
```

## Expression syntax

A date math expression consists of an **anchor** followed by zero or more **operators**.

### Anchor

- `now` — the current time (or the `now` option if provided).
- An ISO-8601 date string separated from operators by `||`, e.g. `2024-01-01||+1M`.

### Operators

| Operator | Description | Example |
|----------|-------------|---------|
| `+<n><unit>` | Add `n` units | `+7d` |
| `-<n><unit>` | Subtract `n` units | `-1h` |
| `/<unit>` | Round to unit | `/d` |

The amount `<n>` defaults to `1` when omitted (e.g. `+d` equals `+1d`).

### Units

| Unit | Meaning |
|------|---------|
| `s` | Seconds |
| `m` | Minutes |
| `h` | Hours |
| `d` | Days |
| `w` | Weeks (ISO-8601, Monday start) |
| `M` | Months |
| `y` | Years |

### Rounding

The `/` operator truncates to the start of the period by default. Pass `roundUp: true` to snap to the end instead (e.g. `23:59:59.999` for `/d`).

## API

### `resolve(expression, options?)`

Parse and evaluate a date math expression in one call. Shorthand for `evaluate(parse(expression), options)`.

### `parse(expression)`

Parse an expression string into a `DateMathExpression` AST. Throws `DateMathError` on invalid input.

### `evaluate(expr, options?)`

Evaluate a parsed `DateMathExpression` into a `Date`.

### `roundDate(date, unit, roundUp)`

Round a `Date` to the boundary of the given unit.

### `isValid(expression)`

Returns `true` if the expression can be parsed without errors.

### Types

- **`DateMathExpression`** — Parsed AST with `anchor` and `ops`.
- **`DateMathOp`** — A single operation (`add`, `sub`, or `round`).
- **`DateMathUnit`** — `"s" | "m" | "h" | "d" | "w" | "M" | "y"`.
- **`DateMathOptions`** — `{ now?: Date; roundUp?: boolean }`.
- **`DateMathError`** — Error with `expression` and `position` fields.

## License

Apache-2.0
