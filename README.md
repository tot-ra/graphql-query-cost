# @pipedrive/graphql-query-cost

Graphql cost analysis, mainly to limit query execution in graphql service before resolvers are executed.

![](https://img.shields.io/travis/pipedrive/graphql-query-cost/master?logo=travis)
![](https://img.shields.io/github/v/release/pipedrive/graphql-query-cost?sort=semver)
![](https://img.shields.io/coveralls/github/pipedrive/graphql-query-cost/master?logo=coveralls)
[![Known Vulnerabilities](https://snyk.io/test/npm/@pipedrive/graphql-query-cost/badge.svg)](https://snyk.io/test/npm/@pipedrive/graphql-query-cost)

# Features

- Query cost calculation based on schema and cost mappings
- Cost directive for the schema
- Cost directive extraction from the schema
- Cost directive value extraction from the schema as cost mappings

# API

In the API documentation, @pipedrive/graphql-query-cost is referred to as `queryCost`, as if it was imported with:

```js
const queryCost = require('@pipedrive/graphql-query-cost');
```

## `queryCost.costDirective`

A custom graphql directive for defining expenses directly in the schema.

```js
const schema = `
  ${queryCost.costDirective}
  type Greeting {
    id: ID
    name: String
  }
  type Query {
    hello(limit: Int!): Greeting @cost(
      complexity: 10,
      network: 1,
      db: 1,
      useMultiplers: true,
      multipliers: ["limit"]
      provides: ["id"]
    )
  }
`;
```

### Directive arguments

| Parameter      | Type     | Description                                                                                                                 | Complexity |   Tokens |
| :------------- | :------- | :-------------------------------------------------------------------------------------------------------------------------- | ---------: | -------: |
| complexity     | Int      | Abstract value                                                                                                              |     n \* 1 |          |
| network        | Int      | Amount of requests required to resolve the field                                                                            |            | n \* 100 |
| db             | Int      | Amount of db requests or query complexity                                                                                   |            | n \* 100 |
| mutlipliers    | [String] | Field arguments for multipling the complexity. If a number is provided the complexity will be multiplied by the number.     |            |          |
| useMultipliers | Boolean  | When defined, field complexity will not be multiplied.<br/>Defaults to **true** unless the directive is **not** defined.    |            |          |
| provides       | [String] | Specify which fields are available for the child on the parent type.<br/>If only those are requested, cost will be ignored. |            |          |

## `queryCost.extractCost`

Returns [cost directive arguments](#directive-arguments) per type definition.

```js
const schema = `
  ${queryCost.costDirective}
  type Greeting {
    id: ID
    name: String @cost(db: 10)
  }
  type Query {
    hello: Greeting @cost(complexity: 10)
  }
`;
const { costMap } = queryCost.extractCost(schema);
// {
//   Query: {
//     hello: {
//       complexity: 10,
//     },
//   },
//   Greeting: {
//     hello: {
//       tokens: 1000, // n * 100
//     },
//   },
// };
```

## `queryCost.calculateCost`

Calculates cost of the current query based on cost mappings and schema.

```js
const schema = `
  type Query {
    hello(limit: Int!): string
    world: string
  }
`
const query = `
  query makeQuery($limit)  {
    hello(limit: $limit)
    world
  }
`
const costMap = {
  Query: {
    hello: {
      complexity: 5
      multipliers: ['limit']
    }
  }
}
const cost = queryCost.calculateCost(
  query, schema, {
    costMap,
    defaultCost: 1,
    variables: {
      $limit: 5
    }
  }
)
// (5 * 5) + 1 = 11
```

# Cost calculation

- Definition of cost for entity/resolver/property should be pessimistic (considered for worst case scenario, cold cache)

## Complexity vs tokens(db, network)

- Complexity argument is multiplied by its own multipliers and every parent mutliplier.
  ```
  deals(limit: 100) @cost(complexity: 2) = 200
  ```
- Tokens define how many **resources** are need to resolve a field. When it's recursive it is multiplied.
- Tokens are only multiplied only by its parents multipliers. Only parent multipliers are used because it takes "parent" times **resources** to execute the query. <br>
  **Example query**
  ```
  deals(limit: 100)
    @cost(complexity: 2, db: 1, network: 1)
  ```
  **Example token cost**
  ```
  complexity(2) * limit(100) + tokens(200) = 400
  ```
  **If tokens were multiplied by own multipler**
  ```
  complexity(200) + tokens(200) * limit(100) = 20200
  ```

## Flat complexity

```graphql
# Schema
type Query {
  field: String @cost(complexity: 3)
  default: String
}

# Query
query {
  field
  default
}
```

Total cost is 4:

- **field** cost is 3
- **default** cost is 1

## Multipliers

- Multipliers are recursive
- Undefined(`Parent.name`) complexity is not multiplied

```graphql
# Schema
type Query {
  parents(limit: Int!, names: [String]): [Parent]
    @cost(complexity: 3, multipliers: ["limit", "names"])
}

type Parent {
  name: String
  children(limit: Int): [Child] @cost(complexity: 5)
}

type Child {
  name: String
}

# Query
{
  parents(limit: 2, names: ["elon", "foo"]) {
    name
    children(limit: 4) {
      name
    }
  }
}
```

| Field path            | Description                                                           |                           Result |
| :-------------------- | :-------------------------------------------------------------------- | -------------------------------: |
| parents               | limit _ names.length _ complexity                                     |                   2 _ 2 _ 3 = 12 |
| parents.name          | default                                                               |                previous + 1 = 13 |
| parents.children      | (parents.limit _ parents.names.length) _ children.limit \* complexity | previous + (2 _ 2 _ 4 \* 5) = 93 |
| parents.children.name | default                                                               |                previous + 1 = 94 |

## Ignoring multipliers

### `useMultipliers`

- Definining `useMultipliers: false` ignores the multipliers

```graphql
# Schema
type Query {
  parents(limit: Int): [Parent] @cost(complexity: 2, multipliers: ["limit"])
}

type Parent {
  name: String @cost(complexity: 8, useMultipliers: false)
}
# Query
{
  parents(limit: 5) {
    name
  }
}
```

| Field path   | Description                      |                Result |
| :----------- | :------------------------------- | --------------------: |
| parents      | limit \* complexity              | c(2) \* limit(5) = 10 |
| parents.name | useMultipliers: false is defined |  previous + c(8) = 18 |

### `provides`

- If all the queried fields are in the list of `provides` argument, then the complexity of the field is ignored and the default cost is applied

```graphql
# Schema
type Query {
  parents(limit: Int): [Parent] @cost(complexity: 3, multipliers: ["limit"], provides: ["id"])
}

type Parent {
  id: ID @cost(complexity: 1)
  name: String
}

# Query
{
  parents(limit: 5) {
    id
  }
}
```

| Field path | Description                                                                                    |                Result |
| :--------- | :--------------------------------------------------------------------------------------------- | --------------------: |
| parents    | limit \* complexity                                                                            | c(3) \* limit(5) = 15 |
| parents.id | no multipliers used, default cost applied - field `parents` already `provides` fields `["id"]` |  previous + c(1) = 16 |

### Recursive queries

```graphql
# Schema
type Query {
  pipelines: [Pipeline]
}

type Pipeline {
  id: ID
  deals: [Deal]
}

type Deal {
  id: ID
  pipeline: Pipeline
}

# Query
{
  pipelines {
    deals {
      pipeline {
        deals {
          pipeline {
            id
          }
        }
      }
    }
  }
}
```

| Field path | Description                                                                            |                                                                Result |
| :--------- | :------------------------------------------------------------------------------------- | --------------------------------------------------------------------: |
| pipelines  | Default cost                                                                           |                                                                     1 |
| deals      | Default cost                                                                           |                                                      previous + 1 = 2 |
| pipeline   | Default cost                                                                           |                                                      previous + 1 = 3 |
| deals      | `deals.pipeline` reverse of `pipeline.deals` already appeared <br /> Recursion level 1 |                               previous \* 100(recursion x1) + 1 = 301 |
| pipeline   | Recursion level increased to 2                                                         | previous _ (100 _ 100)(recursion x2) + 1 = 301 \* 10000 + 1 = 3010001 |
| id         | Default cost                                                                           |                                              (previous + 1) = 3010002 |

#### Recursion multiplier

`recursionMultiplier` default value is `100`. If recursion is detected, thats how much cost gets affected.
`recursionMultiplier` value of `1` will mean that detected recursion doesn't affect cost.
`recursionMultiplier` value gets inherited to deeper levels of the graph, so you can have different values depending on the schema

For cases where schema and resolver can have deeply nested recursive structures (trees or graphs) fetched once into memory,
you can override default behaviour by setting `recursionMultiplier` to lower values.

##### Usage

With maximum cost of `5000` per request, you can see different values of `recursionMultiplier` affects graphq and schema below:

| recursionMultiplier | Cost          |
| :------------------ | :------------ |
| 1                   | 6             |
| 3                   | 1490          |
| 3.65                | 4783          |
| 100 (default)       | 2000001000102 |

- It is recommended that you _don't_ set recursion to `1`, but still leave some recursion scaling limits, such that your query still fits into max cost limit.

```graphql
# Schema
type Query {
  myTree: [TreeLeaf]
}

type TreeLeaf {
  id: ID
  leafs: [TreeLeaf] @cost(recursionMultiplier: 1)
}

# Query
{
  myTree {
    leafs {
      leafs {
        leafs {
          leafs {
            id
          }
        }
      }
    }
  }
}
```

- With great `recursionMultiplier` override power comes great responsibility that you don't reset it to `1` and leave holes in graph cost map.

```graphql
type Query {
  myTree: [TreeLeaf]
}

type TreeLeaf {
  id: ID

  # reset recursionMultiplier back to 100, as its part of the recursive graph
  branch: Branch @cost(recursionMultiplier: 100)
  leafs: [TreeLeaf] @cost(recursionMultiplier: 1)
}

type Branch {
  id: ID
  name: String @cost(network: 1)
  leafs: [TreeLeaf]
}
```

## Development

### Cost debugging

To ease understanding how cost is calculated, you can use `debug:true` param, which will console.log node visiting along with how price is added.
(Maybe it could be a product feature later if further )

```
	calculateCost(`query { a { b { c { b {c { id }}}}}}`, typeDefs, { costMap, debug: true });
```

Debug result:

```
       undefined (<OperationDefinition>)
        a <Field>
         a (<Field>)
          b <Field>
           b (<Field>)
            c <Field>
             c (<Field>)
              b <Field>
               b (<Field>)
                c <Field>
                recursion detected b=>c for 1 times
                recursion detected c=>bfor 1 times
                * recursion multiplier = (10000)
                 c (<Field>)
                  id <Field>
                  = 1
                 == 1
                = 20000
               == 20000
              = 20001
             == 20001
            = 20002
           == 20002
          = 20003
         == 20003
        = 20004
       == 20004
```

# Contribution

- Before making PR, make sure to run `npm run version` & fill CHANGELOG
- `npm-version-<version>` – should be set when creating a pull request. It’s good to set it as soon as possible, so reviewer can validate that the proposed version bump is correct
- `npm-ready-for-publish` – add this label after PR has been approved, it will publish the package to NPM and merge changes to master

## Authors and acknowledgment

Original author - @ErikSchults.
Current maintainers - @tot-ra, @Wolg. Mention in PR, if it is stuck

See [blog post](https://medium.com/pipedrive-engineering/journey-to-a-federated-graphql-cost-of-the-queries-a892f9939f9a)
