const calculateCost = require('./calculateCost');
const { sum } = require('lodash');

it('Uses the default cost', () => {
	const typeDefs = `type Query { field: String }`;
	const cost = calculateCost(`query { field }`, typeDefs, {
		defaultCost: 10,
	});

	expect(cost).toEqual(10);
});

it('Uses cost defined on a field', () => {
	const typeDefs = `type Query { field: String }`;
	const costMap = { Query: { field: { complexity: 4 } } };
	const query = `query { field }`;

	const cost = calculateCost(query, typeDefs, { costMap });

	expect(cost).toEqual(4);
});

describe('Multipliers on limit param (from cost definition based on @cost directive)', () => {
	it('Multiplies defined field cost * ($limit + $arrayLimit) ', () => {
		const typeDefs = `type Query { field(limit: Int, arrayLimit: [String]): [String] }`;
		const costMap = {
			Query: {
				field: {
					complexity: 4,
					multipliers: ['limit', 'arrayLimit'],
				},
			},
		};
		const query = ` query { field(limit: $limit, arrayLimit: $arrayLimit) }`;
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
      multiplierCost(limit: ${limit1}, limit2: ${limit2}, limitArray: ${JSON.stringify(
			limitArray
		)})
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
				grandChildNoParentMultipliers: {
					complexity: 3,
					multipliers: ['limit'],
					useMultipliers: false,
				},
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
		const cost = calculateCost(
			`query {
        field(limit: ${limit}) {
          grandChild {
            existing
          }
        }
      }`,
			typeDefs,
			{ costMap }
		);

		expect(cost).toEqual(
			sum([
				// field
				3 * limit,
				// field.grandChild, 1 because all fields available
				1,
				// field.grandChild.existing
				1,
			])
		);
	});

	it('Uses multipliers, if all fields are not available', () => {
		const cost = calculateCost(
			`query {
        field(limit: ${limit}) {
          grandChild {
            existing
            external
          }
        }
      }`,
			typeDefs,
			{ costMap }
		);

		expect(cost).toEqual(
			sum([
				// field
				3 * limit,
				// field.grandChild
				4 * limit,
				// field.grandChild.existing
				1,
				// field.grandChild.external
				1,
			])
		);
	});
});

describe('fragments', () => {
	it('supports querying using fragments', () => {
		const typeDefs = `type Query { field: String }`;
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

	it('supports querying using fragments', () => {
		const typeDefs = `type Query { field: String }`;
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

	it('Calculates cost for fragments', () => {
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
		const interfaceCost = calculateCost(
			createQuery('fieldInterface'),
			typeDefs,
			{ costMap, variables }
		);

		expect(interfaceCost).toEqual(
			sum([
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
			])
		);

		const unionCost = calculateCost(createQuery('fieldUnion'), typeDefs, {
			costMap,
			variables,
		});

		expect(interfaceCost).toEqual(unionCost);
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
		const cost = calculateCost(
			`query {
				parent(limit: ${limit}) {
					name
				}
			}`,
			typeDefs,
			{ costMap }
		);

		expect(cost).toEqual(
			sum([
				// parent tokens
				10,
				// parent multipliers * complexity
				limit * 2,
				// parent.name
				1,
			])
		);
	});

	it('Multiplies tokens when parent has multipliers', () => {
		const limit = 8;
		const cost = calculateCost(
			`query {
				parent(limit: ${limit}) {
					name
					child
				}
			}`,
			typeDefs,
			{ costMap }
		);

		expect(cost).toEqual(
			sum([
				// parent tokens
				10,
				// parent multipliers * complexity
				limit * 2,
				// parent.name
				1,
				// parent.child complexity * multipliers + tokens * multipliers
				1 * limit + 20 * limit,
			])
		);
	});

	it('Tokens are only multiplied by parent multipliers, self multiplers are ignored', () => {
		const typeDefs = `
			type Query {
				parent(parentMultiplier: Int!): Parent
			}
			type Parent {
				id: ID
				child: Child
			}
			type Child {
				id: ID
				child(childMultiplier: Int!): GrandChild
			}
			type GrandChild {
				id: ID
			}
		`;
		const costMap = {
			Query: {
				parent: {
					tokens: 4,
					complexity: 11,
					multipliers: ['parentMultiplier'],
				},
			},
			Parent: {
				child: {
					tokens: 2,
				},
			},
			Child: {
				child: {
					tokens: 3,
					complexity: 2,
					multipliers: ['childMultiplier'],
				},
			},
			GrandChild: {
				id: {
					complexity: 10,
					tokens: 2,
				},
			},
		};
		const cost = calculateCost(
			`query {
				parent(parentMultiplier: 2) {
					child {
						child(childMultiplier: 10) {
							id
						}
					}
				}
			}`,
			typeDefs,
			{ costMap }
		);

		expect(cost).toEqual(
			sum([
				// parent.child.child.id
				// totalMultiplier  = parentMultiplier(2) * childMultiplier(10) = 20
				//
				// complexityCost	= totalMultiplier(20) * complexity(10) 		= 200
				// tokenCost 		= totalMultiplier(20) * tokens(3)			= 40
				// -  both parentMultiplier and childMultiplier are .id fields parent multipliers
				240,
				// parent.child.child
				// totalMultiplier	= parentMultiplier(2) * childMultiplier(10) = 20
				//
				// complexityCost 	= totalMultiplier(20) * complexity(2)		= 40
				// tokenCost 		= parentMultiplier(2) * tokens(3)			= 6
				// -  only parent multipler is used, fields own multipler(childMultiplier) is not
				// cost 			= complexityCost(40) + tokenCost(6) 		= 46
				46,
				// parent.child
				// totalMultiplier 	= parentMultiplier(2)
				//
				// complexityCost 	= totalMultiplier(2) * complexity(1) 		= 2
				// tokenCost 		= parentMultiplier(2) * tokens(2) 			= 4
				// cost 			= complexityCost(2) + tokenCost(4) 			= 6
				6,
				// parent
				// complexityCost	= parentMultiplier(2) * complexity(11) 		= 22
				// tokenCost 		= tokens(4) * noParentMultiplier(1) 		= 4
				// cost 			= complexityCost(2) + tokenCost(4)			= 26
				26,
			])
		);
	});

	it('Does not multiply tokens when specified', () => {
		const limit = 8;
		const cost = calculateCost(
			`query {
				parent(limit: ${limit}) {
					name
					noMultipliers
				}
			}`,
			typeDefs,
			{ costMap }
		);

		expect(cost).toEqual(
			sum([
				// parent tokens + (multipliers * complexity)
				10 + limit * 2,
				// parent.name (default)
				1,
				// parent.noMultipliers (complexity + tokens)
				3 + 30,
			])
		);
	});

	it('Ignores tokens when all requested fields provided by parent', () => {
		const limit = 8;
		const cost = calculateCost(
			`query {
				parent(limit: ${limit}) {
					provides {
						id
					}
				}
			}`,
			typeDefs,
			{ costMap }
		);

		expect(cost).toEqual(
			sum([
				// parent
				10 + 2 * limit,
				// provides
				1,
				// provides.id
				1,
			])
		);
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

		expect(
			calculateCost(
				`query {
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
			}`,
				typeDefs,
				{ costMap }
			)
		).toEqual(6);

		// 4 fields in total
		expect(
			calculateCost(
				`
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
			`,
				typeDefs,
				{ costMap }
			)
		).toEqual(6);
	});
});

describe('recursion/circular references', () => {
	const typeDefs = `
			type Query {
				queryDeals: [Deal]
			}
			type Deal {
				id: ID
				pipeline: Pipeline
			}
			type Pipeline {
				id: ID
				deals: [Deal]
			}
		`;
	const costMap = {};

	it('Allow no circular reference of 2 level nesting', () => {
		expect(
			calculateCost(
				`query {
			queryDeals {
				pipeline {
					deals {
						id
					}
				}
			}
		}`,
				typeDefs,
				{ costMap }
			)
		).toEqual(4);
	});

	it('Allow flat but repeating A,A->B,A-C referencing', () => {
		expect(
			calculateCost(
				`query {
			user {
				id
			}
			user {
				roleSettings {
					org_default_visibility
				}
			}
			user {
				permissions {
					can_change_visibility_of_items
				}
			}
		}`,
				typeDefs,
				{ costMap }
			)
		).toEqual(8);
	});

	it('Allow circular reference A->B->A with id on last level costs 302', () => {
		expect(
			calculateCost(
				`query {
			queryDeals {
				pipeline {
					deals {
						pipeline {
							id
						}
					}
				}
			}
		}`,
				typeDefs,
				{ costMap }
			)
		).toBeLessThan(5000);
	});

	it('Allow 3-depth circular reference A->B->A with id on every level costs 404', () => {
		expect(
			calculateCost(
				`query {
				queryDeals {
					id
					pipeline {
						id
						deals {
							id
							pipeline {
								id
							}
						}
					}
				}
			}`,
				typeDefs,
				{ costMap }
			)
		).toBeLessThan(5000);
	});

	it('Deny 4-depth circular reference A->B->A->B with id on last level', () => {
		expect(
			calculateCost(
				`query {
			queryDeals {
				pipeline {
					deals {
						pipeline {
							deals {
								id
							}
						}
					}
				}
			}
		}`,
				typeDefs,
				{ costMap }
			)
		).toBeGreaterThan(5000);
	});

	it('Deny 4-depth circular reference in fragments', () => {
		expect(
			calculateCost(
				`
			query {
				...RootFragment
			}

			fragment RootFragment on RootQuery {
				queryDeals {
					pipeline {
						...PipelineFragment
					}
				}
				queryDeals {
					pipeline {
						id
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
					deals {
						id
					}
				}
			}
		`,
				typeDefs,
				{ costMap }
			)
		).toBeGreaterThan(5000);
	});

	it('Deny 5-depth circular reference A->B->A->B->A with id on last level', () => {
		expect(
			calculateCost(
				`query {
				queryDeals {
					pipeline {
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
			}`,
				typeDefs,
				{ costMap }
			)
		).toBeGreaterThan(5000);
	});
});
