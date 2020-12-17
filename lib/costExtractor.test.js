const extractCost = require('./costExtractor');
const complexityTokens = extractCost.complexityTokens;
const costDirective = require('./costDirective');

describe('extractCost should extract cost and cleanup directive definition', () => {
	it('Extracts (complexity) on FIELD cost', () => {
		const schemaCostIncluded = `${costDirective}
type Deal {
  org: Integer @cost(complexity: 4)
}`;

		const schemaCostRemoved = `type Deal {
  org: Integer
}
`;

		const expectedCostMap = {
			Deal: {
				org: {
					complexity: 4,
				},
			},
		};

		const result = extractCost(schemaCostIncluded);

		expect(result.cleanSchema).toEqual(schemaCostRemoved);
		expect(result.costMap).toEqual(expectedCostMap);
	});

	it('Extracts (tokens, multipliers) on FIELD if type extends another', () => {
		const schemaCostIncluded = `${costDirective}
extend type User @key(fields: "id") {
  id: ID! @external
  deals(limit: Int!): [Deal] @cost(complexity: 2, multipliers: ["limit"], db: 1)
  org: Organization @cost(complexity: 4, useMultipliers: false)
}`;

		const schemaCostRemoved = `extend type User @key(fields: "id") {
  id: ID! @external
  deals(limit: Int!): [Deal]
  org: Organization
}
`;

		const expectedCostMap = {
			User: {
				deals: {
					tokens: 1 * complexityTokens.db,
					complexity: 2,
					multipliers: ['limit'],
				},
				org: {
					complexity: 4,
					useMultipliers: false,
				},
			},
		};

		const result = extractCost(schemaCostIncluded);

		expect(result.cleanSchema).toEqual(schemaCostRemoved);
		expect(result.costMap).toEqual(expectedCostMap);
	});

	it('Extracts (multipliers & network token) FIELD cost', () => {
		const schemaCostIncluded = `${costDirective}
type Query {
  deals(limit: Int!): [Deal] @cost(network: 2, multipliers: ["limit"])
}
`;

		const schemaCostRemoved = `type Query {
  deals(limit: Int!): [Deal]
}
`;

		const expectedCostMap = {
			Query: {
				deals: {
					tokens: 2 * complexityTokens.network,
					multipliers: ['limit'],
				},
			},
		};

		const result = extractCost(schemaCostIncluded);

		expect(result.costMap).toEqual(expectedCostMap);
		expect(result.cleanSchema).toEqual(schemaCostRemoved);
	});

	it('Extracts (provides) on FIELD from nested Deal -> Org', () => {
		const schemaCostIncluded = `${costDirective}

type Organization {
  id: ID!
  name: String! @cost
  users: [User] @cost(multipliers: "limit", provides: "id") # should be array of strings
}

type Deal {
  id: ID!
  title: String! @cost(multipliers: [])
  org: Organization @cost(complexity: 2, provides: ["id", "name"])
}

schema {
  query: Query
}`;

		const schemaCostRemoved = `type Organization {
  id: ID!
  name: String!
  users: [User]
}

type Deal {
  id: ID!
  title: String!
  org: Organization
}

schema {
  query: Query
}
`;

		const expectedCostMap = {
			Deal: {
				org: {
					complexity: 2,
					provides: ['id', 'name'],
				},
			},
		};

		const result = extractCost(schemaCostIncluded);

		expect(result.costMap).toEqual(expectedCostMap);
		expect(result.cleanSchema).toEqual(schemaCostRemoved);
	});
});
