# Server Function Convention

Instrument each framework server function invocation (TanStack Start server functions, Next.js server actions, and similar) as one span:

- Span name: `serverFn {name}`, falling back to `serverFn` when the framework provides no name.
- `everr.server_function.name`: the framework's own identifier for the function, verbatim (for example `getActiveOrganization`). Do not rename, prefix, or namespace it.
- `everr.server_function.transport`: `http` when the invocation arrived as its own request, `in-process` otherwise.
