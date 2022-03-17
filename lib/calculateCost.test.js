const calculateCost = require('./calculateCost');
const { sum } = require('lodash');

it('Uses the default cost', () => {
	const typeDefs = `type Query { field: String }`;
	const cost = calculateCost(`query { field }`, typeDefs, { defaultCost: 10 });

	expect(cost).toEqual(10);
});

it('Uses cost defined on a field', () => {
	const typeDefs = `type Query { field: String }`;
	const costMap = { Query: { field: { complexity: 4 } } };
	const query = ` query { field }`;

	const cost = calculateCost(query, typeDefs, { costMap });

	expect(cost).toEqual(4);
});

it('Calculates nested queries', () => {
	const typeDefs = `
type User {
	id: ID!
	email: String
}

type Deal {
	id: ID!
	owner: User
}

type Query {
	deal: Deal
}
`;
	const costMap = {
		Deal: {
			owner: {
				provides: ['id'],
				tokens: 100,
				useMultipliers: false,
			},
		},
		Query: {
			deal: {
				tokens: 100,
			},
		},
	};

	const query = `
{
	deal {
		owner {
			id
			email
		}
	}
}
`;

	const cost = calculateCost(query, typeDefs, {
		costMap,
	});

	expect(cost).toEqual(
		sum([
			// deal
			101,
			// deal.owner
			101,
			// deal.owner.id field
			1,
			// deal.owner.email field
			1,
		]),
	);
});

describe('Multipliers on limit param (from cost definition based on @cost directive)', () => {
	it('Multiplies defined field cost * ($limit + $arrayLimit) ', () => {
		const typeDefs = `type Query { field(limit: Int, arrayLimit: [String]): [String] }`;
		const costMap = {
			Query: {
				field: {
					complexity: 4, multipliers: ['limit', 'arrayLimit'],
				},
			},
		};
		const query = `query { field(limit: $limit, arrayLimit: $arrayLimit) }`;
		const variables = { limit: 8, arrayLimit: ['1', '2'] };

		const cost = calculateCost(query, typeDefs, { costMap, variables });

		expect(cost).toEqual(4 * (8 + 2));
	});

	it('Uses length of an array($limitArray) param as a multiplier', () => {
		const typeDefs = `type Query {
      field(limit: Int!, limit2: Int!, limitArray: [String!]!): String
    }`;
		const costMap = {
			Query: {
				multiplierCost: {
					complexity: 5,
					multipliers: ['limit', 'limit2', 'limitArray'],
				},
			},
		};
		const limit1 = 11;
		const limit2 = 3;
		const limitArray = ['1', '2'];
		const query = `query {
      multiplierCost(limit: ${limit1}, limit2: ${limit2}, limitArray: ${JSON.stringify(limitArray)})
    }`;

		const cost = calculateCost(query, typeDefs, { costMap });

		expect(cost).toEqual((limit1 + limit2 + limitArray.length) * 5);
	});

	it('Uses multipliers on children, or not if useMultiplers = false', () => {
		const typeDefs = `
      type Query {
        field(limit: Int): Child
      }

      type Child {
        grandChild(limit: Int): GrandChild
        grandChildNoParentMultipliers(limit: Int): GrandChild
      }

      type GrandChild {
        defaultWithoutMultipliers: Int
        withMultipliers: Int
      }
    `;
		const limit = 7;
		const query = `query {
      field(limit: ${limit}) {
        grandChild(limit: ${limit}) {
          defaultWithoutMultipliers
          withMultipliers
        }
        grandChildNoParentMultipliers(limit: ${limit}) {
          defaultWithoutMultipliers
          withMultipliers
        }
      }
    }`;
		const costMap = {
			Query: {
				field: { complexity: 3, multipliers: ['limit'] },
			},
			Child: {
				grandChild: { complexity: 4, multipliers: ['limit'] },
				grandChildNoParentMultipliers: { complexity: 3, multipliers: ['limit'], useMultipliers: false },
			},
			GrandChild: {
				withMultipliers: { complexity: 2 },
			},
		};

		const cost = calculateCost(query, typeDefs, { costMap });

		const costs = [
			// base field
			3 * limit,
			// grandChild
			4 * (limit * limit),
			// grandChild.defaultWithoutMultipliers
			1,
			// grandChild.withMultipliers
			2 * (limit * limit),
			// grandChildNoParentMultipliers
			3 * limit,
			// grandChildNoParentMultipliers.defaultWithoutMultipliers
			1,
			// grandChildNoParentMultipliers.withMultipliers
			2 * limit,
		];

		expect(cost).toEqual(sum(costs));
	});
});

describe('Ignore cost when fields are available', () => {
	const typeDefs = `
      type Query {
        field(limit: Int): Child
      }
      type Child {
        grandChild: GrandChild
      }
      type GrandChild {
        existing: String
        external: String
      }
    `;
	const costMap = {
		Query: {
			field: { complexity: 3, multipliers: ['limit'] },
		},
		Child: {
			grandChild: { complexity: 4, provides: ['existing'] },
		},
	};

	const limit = 7;

	it('Ignores multipliers, if all fields are available', () => {
		const cost = calculateCost(`query {
        field(limit: ${limit}) {
          grandChild {
            existing
          }
        }
      }`, typeDefs, { costMap });

		expect(cost).toEqual(sum([
			// field
			3 * limit,
			// field.grandChild, 1 because all fields available
			1,
			// field.grandChild.existing
			1,
		]));
	});

	it('Uses multipliers, if all fields are not available', () => {
		const cost = calculateCost(`query {
        field(limit: ${limit}) {
          grandChild {
            existing
            external
          }
        }
      }`, typeDefs, { costMap });

		expect(cost).toEqual(sum([
			// field
			3 * limit,
			// field.grandChild
			4 * limit,
			// field.grandChild.existing
			1,
			// field.grandChild.external
			1,
		]));
	});

	it('Deny fragment recursion with reserved words in it', () => {
		const query = `
		query {
			pipeline {
				edges{
					node{
						deals {
							...PipelineFragment
						}
					}
				}
			}
		}
		fragment PipelineFragment on Pipeline {
			deals {
				...DealsFragment
			}
		}
		fragment DealsFragment on Deal {
			pipeline {
				edges{
					node{
						deals {
							id
						}
					}
				}
			}
		}
	`;

		const cost = calculateCost(query, typeDefs, { costMap });

		expect(cost).toBeGreaterThan(5000); // hard limit
	});
});

describe('fragments', () => {
	const typeDefs = `type Query { field: String }`;

	it('supports querying with one fragment', () => {
		const costMap = { Query: { field: { complexity: 4 } } };
		const query = ` query RRR{
   ...fragment
 }

 fragment fragment on FFF {
   field
 }`;

		const cost = calculateCost(query, typeDefs, { costMap });

		expect(cost).toEqual(1);
	});

	it('supports querying with 2 types having 1 fragment each', () => {
		const costMap = { Query: { field: { complexity: 4 } } };
		const query = `query RRR{
	   pipelines{
			...fragment
	   }
	   deals{
			...fragment
	   }
 }

 fragment fragment on FFF {
   users{
   	id
   }
 }`;

		const cost = calculateCost(query, typeDefs, { costMap });

		expect(cost).toEqual(6);
	});

	it('calculates cost for fragments and union', () => {
		const typeDefs = `
      type Query {
        fieldInterface: Child
        fieldUnion: Child1Or2
      }
      interface Child {
        name: String
      }
      type Child1 implements Child {
        name: String
        foo(limit: Int): GrandChild
      }
      type Child2 implements Child {
        name: String
        bar(limit: Int): GrandChild
      }
      union Child1Or2 = Child1 | Child2

      type GrandChild {
        name: String
      }
    `;
		const costMap = {
			Query: {
				fieldInterface: { complexity: 3 },
				fieldUnion: { complexity: 3 },
			},
			Child1: {
				foo: { complexity: 4, multipliers: ['limit'] },
			},
			Child2: {
				bar: { complexity: 5, multipliers: ['limit'] },
			},
		};
		const limit = 8;
		const createQuery = (field) => `
      query {
        ${field} {
          name
          ...FragmentSpreader
          ...on Child2 {
            bar(limit: ${limit}) {
              name
            }
          }
        }
      }
      fragment FragmentSpreader on Child1 {
        foo(limit: $foolimit) {
          name
        }
      }
    `;
		const variables = { foolimit: 6 };
		const cost = calculateCost(createQuery('fieldInterface'), typeDefs, { costMap, variables });

		expect(cost).toEqual(sum([
			// field
			3,
			// filed.Child.name
			1,
			// field.Child1.foo
			4 * variables.foolimit,
			// field.Child1.foo.name
			1,
			// field.Child2.bar
			5 * limit,
			// field.Child2.bar.name
			1,
		]));

		const unionCost = calculateCost(createQuery('fieldUnion'), typeDefs, { costMap, variables });

		expect(cost).toEqual(unionCost);
	});

	it('calculates multiple fragments per type', () => {
		const costMap = { Query: { field: { complexity: 4 } } };

		const omnichannelQuery = `query RouterQuery{
      node(id: "xxx") {
        __typename
        ... on OmnichannelConversation {
          ...a
          ...b
          ...c
        }
      }
    }

    fragment a on OmnichannelConversation {
      xx {
        id
      }
    }

    fragment b on OmnichannelConversation {
      xx {
        id
      }
    }

    fragment c on OmnichannelConversation {
      id
      xx {
        id
      }
    }`;

		expect(calculateCost(omnichannelQuery, typeDefs, { costMap })).toBeLessThan(5000);
	});

	it('calculates multiple recurring fragments', () => {
		const costMap = { Query: { field: { complexity: 4 } } };

		const omnichannelQuery = `query qqq {
		user(id: "xxx") {
			...aaa
			id
		}
	}
	fragment aaa on User {
		...bbb
	}

	fragment bbb on User {
		followers {
			user {
				id
				name
			}
		}
		...ccc
	}

	fragment ccc on User {
		followers {
			user {
				id
			}
		}
	}
`;

		expect(calculateCost(omnichannelQuery, typeDefs, { costMap })).toBeLessThan(5000);
	});
});

describe('unions', () => {
	it('calculates cost for union', () => {
		const typeDefs = `
type Organization {
  id: ID!
}

type Deal {
  id: ID!
}

union ActivityEntity = Organization | Deal

type Activity {
  entity: ActivityEntity
}

type Query {
	activity: Activity
}
    `;
		const costMap = {
			Activity: {
				entity: {
					complexity: 500,
				},
			},
		};

		const query = `
{
	activity {
		entity {
			... on Deal {
				id
			}
		}
	}
}
    `;

		const cost = calculateCost(query, typeDefs, {
			costMap,
		});

		expect(cost).toEqual(
			sum([
				// Activity
				1,
				// Activity.entity
				500,
				// Activity.entity.id
				1,
			]),
		);
	});
});

describe('tokens', () => {
	const typeDefs = `
				type Query {
					parent(limit: Int!): Parent
				}
				type Parent {
					name: String
					child: String
					noMultipliers: String
					provides: String
				}
				type Child {
					id: String
					name: String
				}
			`;
	const costMap = {
		Query: {
			parent: {
				tokens: 10,
				complexity: 2,
				multipliers: ['limit'],
			},
		},
		Parent: {
			child: {
				complexity: 1,
				tokens: 20,
			},
			noMultipliers: {
				useMultipliers: false,
				complexity: 3,
				tokens: 30,
			},
			provides: {
				provides: ['id'],
				complexity: 3,
				tokens: 10,
			},
		},
	};

	it('Adds tokens as extra cost, when there are no parent multipliers ', () => {
		const limit = 8;
		const cost = calculateCost(`query {
				parent(limit: ${limit}) {
					name
				}
			}`, typeDefs, { costMap });

		expect(cost).toEqual(sum([
			// parent tokens
			10,
			// parent multipliers * complexity
			limit * 2,
			// parent.name
			1,
		]));
	});

	it('Multiplies tokens when parent has multipliers', () => {
		const limit = 8;
		const cost = calculateCost(`query {
				parent(limit: ${limit}) {
					name
					child
				}
			}`, typeDefs, { costMap });

		expect(cost).toEqual(sum([
			// parent tokens
			10,
			// parent multipliers * complexity
			limit * 2,
			// parent.name
			1,
			// parent.child complexity * multipliers + tokens * multipliers
			(1 * limit) + (20 * limit),
		]));
	});

	it('Does not multiply tokens when specified', () => {
		const limit = 8;
		const cost = calculateCost(`query {
				parent(limit: ${limit}) {
					name
					noMultipliers
				}
			}`, typeDefs, { costMap });

		expect(cost).toEqual(sum([
			// parent tokens + (multipliers * complexity)
			10 + (limit * 2),
			// parent.name (default)
			1,
			// parent.noMultipliers (complexity + tokens)
			3 + 30,
		]));
	});

	it('Ignores tokens when all requested fields provided by parent', () => {
		const limit = 8;
		const cost = calculateCost(`query {
				parent(limit: ${limit}) {
					provides {
						id
					}
				}
			}`, typeDefs, { costMap });

		expect(cost).toEqual(sum([
			// parent
			10 + (2 * limit),
			// provides
			1,
			// provides.id
			1,
		]));
	});

	it('Ignores tokens on fragments when all requested fields provided by parent', () => {
		const typeDefs = `
				type Query {
					deals: [Deal]
				}
				type Deal {
					id: ID
					customFields: [CustomField]
				}

				interface CustomField {
					id: ID
				}
				type CustomFieldPerson implements CustomField {
					id: ID
					person: Person
				}
				type Person {
					id: ID
					name: String
				}
			`;
		const costMap = {
			CustomFieldPerson: {
				person: {
					tokens: 10,
					provides: ['id'],
				},
			},
		};

		expect(calculateCost(`query {
				deals {
					id
					customFields {
						id
						...on CustomFieldPerson {
							person {
								id
							}
						}
					}
				}
			}`, typeDefs, { costMap })).toEqual(6);

		// 4 fields in total
		expect(calculateCost(`
				query {
					deals {
						id
						customFields {
							id
							...PersonFragment
						}
					}
				}
				fragment PersonFragment on CustomFieldPerson {
					person {
						id
					}
				}
			`, typeDefs, { costMap })).toEqual(6);
	});
});
