# graphql-query-cost

Graphql cost anlysis utilities.

![](https://img.shields.io/travis/pipedrive/graphql-query-cost/master?logo=travis)
![](https://img.shields.io/github/v/release/pipedrive/graphql-query-cost?sort=semver)
![](https://img.shields.io/coveralls/github/pipedrive/graphql-query-cost/master?logo=coveralls)

# Features

- Cost directive for the schema
- Cost directive extraction from the schema
- Cost directive value extraction from the schema as cost mappings
- Query cost calculation based on schema and cost mappings

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
`
```


### Directive arguments


| Parameter      | Type     | Description                                                                                                                 | Complexity |  Tokens |
| :------------- | :------- | :-------------------------------------------------------------------------------------------------------------------------- | ---------: | ------: |
| complexity     | Int      | Abstract value                                                                                                              |      n * 1 |         |
| network        | Int      | Amount of requests required to resolve the field                                                                            |            | n * 100 |
| db             | Int      | Amount of db requests or query complexity                                                                                   |            | n * 100 |
| mutlipliers    | [String] | Field arguments for multipling the complexity                                                                               |            |         |
| useMultipliers | Boolean  | When defined, field complexity will not be multiplied.<br/>Defaults to **true** unless the directive is **not** defined.    |            |         |
| provides       | [String] | Specify which fields are available for the child on the parent type.<br/>If only those are requested, cost will be ignored. |            |         |

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
`
const { costMap } = queryCost.extractCost(schema)
costMap == {
  Query: {
    hello: {
      complexity: 10
    }
  },
  Greeting: {
    hello: {
      tokens: 1000 // n * 100
    }
  }
}
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
cost === (5 * 5) + 1
```

# Cost calculation

- Definition of cost for entity/resolver/property should be pessimistic (considered for worst case scenario, cold cache)

## Complexity vs tokens(network)
- Complexity argument is multiplied by its own multipliers and every parent mutliplier
- Tokens are only multiplied by only by parents multipliers.
- Tokens define how many **resources** are need to resolve a field. When it's recursive it is multiplied.


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
- __field__ cost is 3
- __default__ cost is 1

## Multipliers
- Multipliers are recursive
- Undefined(`Parent.name`) complexity is not multiplied

```graphql
# Schema
type Query {
  parents(limit: Int!, names: [String]): [Parent] @cost(
    complexity: 3,
    multipliers: ["limit", "names"]
  )
}

type Parent {
  name: String
  children(limit: Int): [Child] @cost(complexity: 5)
}

type Child { name: String }

# Query
{
  parents(limit: 2, names: ["elon", "foo"]) {
    name
    children(limit: 4) { name }
  }
}
```

| Field path            | Description                                                          |                          Result |
| :-------------------- | :------------------------------------------------------------------- | ------------------------------: |
| parents               | limit * names.length * complexity                                    |                  2 * 2 * 3 = 12 |
| parents.name          | default                                                              |               previous + 1 = 13 |
| parents.children      | (parents.limit * parents.names.length) * children.limit * complexity | previous + (2 * 2 * 4 * 5) = 93 |
| parents.children.name | default                                                              |               previous + 1 = 94 |

## Ignoring multipliers

### `useMultipliers`
- Definining `useMultipliers: false` ignores the multipliers
```graphql
# Schema
type Query {
  parents(limit: Int): [Parent] @cost(
    complexity: 2,
    multipliers: ["limit"]
  )
}

type Parent {
  name: String @cost(
    complexity: 8,
    useMultipliers: false
  )
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
| parents      | limit * complexity               | c(2) * limit(5)  = 10 |
| parents.name | useMultipliers: false is defined |  previous + c(8) = 18 |


### `provides`
- If all the queried fields are in the list of `provides` argument, then the complexity of the field is ignored and the default cost is applied
```graphql
# Schema
type Query {
  parents(limit: Int): [Parent] @cost(
    complexity: 3,
    multipliers: ["limit"]
    provides: ["id"]
  )
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
| parents    | limit * complexity                                                                             | c(3) * limit(5)  = 15 |
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

| Field path | Description                                                                            |                                                               Result |
| :--------- | :------------------------------------------------------------------------------------- | -------------------------------------------------------------------: |
| pipelines  | Default cost                                                                           |                                                                    1 |
| deals      | Default cost                                                                           |                                                   previous +  1  = 2 |
| pipeline   | Default cost                                                                           |                                                   previous +  1  = 3 |
| deals      | `deals.pipeline` reverse of `pipeline.deals` already appeared <br /> Recursion level 1 |                               previous * 100(recursion x1) + 1 = 301 |
| pipeline   | Recursion level increased to 2                                                         | previous * (100 * 100)(recursion x2) + 1 = 301 * 10000 + 1 = 3010001 |
| id         | Default cost                                                                           |                                            (previous +  1) = 3010002 |
