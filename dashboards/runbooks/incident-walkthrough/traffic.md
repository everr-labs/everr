# Traffic

Did the request mix change? Three views over the same question.

## Volume by route over time

A heatmap makes a shifted mix obvious — look for a row that brightens while
the others stay flat:

```panel
kind: Panel
height: 320
spec:
  display: { name: "Requests by route" }
  plugin:
    kind: Heatmap
    spec:
      unit: req
      colorScheme: greens
      showLegend: true
  queries:
    - kind: TestData
      spec:
        plugin:
          kind: TestData
          spec:
            scenario: random_walk
            seed: 31
            labelColumn: route
            series:
              - { name: /checkout, start: 60, noise: 20, min: 0 }
              - { name: /search,   start: 40, noise: 15, min: 0 }
              - { name: /api,      start: 80, noise: 25, min: 0 }
              - { name: /static,   start: 20, noise: 10, min: 0 }
```

## Share of traffic per route

```panel
kind: Panel
height: 300
spec:
  display: { name: "Traffic share" }
  plugin:
    kind: Treemap
    spec: { nameColumn: route, valueColumn: requests, unit: req }
  queries:
    - kind: TestData
      spec:
        plugin:
          kind: TestData
          spec:
            scenario: csv
            columns: [route, requests]
            rows:
              - [/checkout, 4200]
              - [/search, 2600]
              - [/api, 8100]
              - [/static, 1800]
              - [/login, 1200]
              - [/profile, 750]
```

## Where the traffic comes from

A regional shift (e.g. a bot wave from one geography) shows up here first:

```panel
kind: Panel
height: 380
spec:
  display: { name: "Requests by origin" }
  plugin:
    kind: GeoMap
    spec:
      mode: points
      colorScheme: blue
      showLegend: true
  queries:
    - kind: TestData
      spec:
        plugin:
          kind: TestData
          spec: { scenario: geo, shape: points, seed: 32, points: 24 }
```

**Verdict:** traffic volume and mix were normal. Move on to
[Dependencies](./dependencies.md).
