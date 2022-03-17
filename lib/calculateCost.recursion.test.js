const calculateCost = require('./calculateCost');

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
		const query = `query {
			queryDeals {
				pipeline {
					deals {
						id
					}
				}
			}
		}`;

		const cost = calculateCost(query, typeDefs, { costMap });

		expect(cost).toBeLessThan(5000); // hard limit
		expect(cost).toEqual(4); // can be change slightly
	});

	it('Allow flat but repeating A,A->B,A-C referencing', () => {
		const query = `query {
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
		}`;
		const cost = calculateCost(query, typeDefs, { costMap });

		expect(cost).toBeLessThan(5000); // hard limit
		expect(cost).toEqual(8); // can be change slightly
	});

	it('Allow circular reference A->B->A with id on last level costs 302', () => {
		const query = `query {
			queryDeals {
				pipeline {
					deals {
						pipeline {
							id
						}
					}
				}
			}
		}`;
		const cost = calculateCost(query, typeDefs, { costMap });

		expect(cost).toBeLessThan(5000); // hard limit
		expect(cost).toEqual(203); // can be change slightly
	});

	it('Allow 3-depth circular reference A->B->A with id on every level costs 404', () => {
		// don't go circular about "id" field
		const query = `query {
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
			}`;
		const cost = calculateCost(query, typeDefs, { costMap });

		expect(cost).toBeLessThan(5000); // hard limit
		expect(cost).toEqual(206); // can be change slightly
	});

	it('Deny 4-depth circular reference A->B->A->B with id on last level', () => {
		const query = `query {
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
		}`;
		const cost = calculateCost(query, typeDefs, { costMap });

		expect(cost).toBeGreaterThan(5000); // hard limit
		expect(cost).toEqual(20103); // can be change slightly
	});

	it('Deny 4-depth circular reference in fragments', () => {
		const query = `
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
	`;
		const cost = calculateCost(query, typeDefs, { costMap });

		expect(cost).toBeGreaterThan(5000); // hard limit
		expect(cost).toEqual(20106); // can be change slightly
	});

	it('Deny 4-depth circular reference A->B->A->B with id on last level in a fragment', () => {
		const query = `
		query {
			...RootFragment
		}
		fragment RootFragment on RootQuery {
			...aaa
		}
		fragment aaa on RootQuery {
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
		}`;
		const cost = calculateCost(query, typeDefs, { costMap });

		expect(cost).toBeGreaterThan(5000); // hard limit
		expect(cost).toEqual(20103); // can be change slightly
	});

	it('Deny 5-depth circular reference A->B->A->B->A with id on last level', () => {
		const query = `query {
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
		}`;
		const cost = calculateCost(query, typeDefs, { costMap });

		expect(cost).toBeGreaterThan(5000); // hard limit
		expect(cost).toEqual(200010103); // can be change slightly
	});

	it('Deny 5-depth circular reference A->B->A->B->A with id on last level withing a fragment', () => {
		const query = `query {
				...aaa
			}
			fragment aaa on User {
				...bbb
			}
			fragment bbb on User {
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
		}`;
		const cost = calculateCost(query, typeDefs, { costMap });

		expect(cost).toBeGreaterThan(5000); // hard limit
		expect(cost).toEqual(200010103); // can be change slightly
	});

	describe('recursionMultiplier override', () => {
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

		it('Allow 4-depth circular reference A->B->A->B if Query.recursionMultiplier = 1 instead of 100', () => {
			const costMap = {
				Deal: {
					pipeline: {
						tokens: 100,
						useMultipliers: false,
					},
				},
				Query: {
					queryDeals: {
						tokens: 100,
						recursionMultiplier: 1,
					},
				},
			};

			const query = `query {
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
			}`;
			const cost = calculateCost(query, typeDefs, { costMap });

			expect(cost).toBeLessThan(5000); // hard limit
			expect(cost).toEqual(407); // can be change slightly
		});

		it('supports float-type recursionMultiplier = 1.1', () => {
			const costMap = {
				Deal: {
					pipeline: {
						tokens: 100,
						useMultipliers: false,
					},
				},
				Pipeline: {
					deals: {
						tokens: 100,
						useMultipliers: false,
					},
				},
				Query: {
					queryDeals: {
						tokens: 100,
						recursionMultiplier: 1.1,
					},
				},
			};

			const query = `query {
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
			}`;
			const cost = calculateCost(query, typeDefs, { costMap });

			expect(cost).toBeLessThan(5000); // hard limit
			expect(Math.round(cost)).toEqual(686); // can be change slightly
		});

		it('supports override of recursionMultiplier=1 to recursionMultiplier: 10 in deeper levels', () => {
			const costMap = {
				Deal: {
					pipeline: {
						tokens: 100,
						useMultipliers: false,
						recursionMultiplier: 2,
					},
				},
				Pipeline: {
					deals: {
						tokens: 100,
						useMultipliers: false,
						recursionMultiplier: 2,
					},
				},
				Query: {
					queryDeals: {
						tokens: 100,
						recursionMultiplier: 1,
					},
				},
			};

			const query = `query {
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
			}`;
			const cost = calculateCost(query, typeDefs, { costMap });

			expect(cost).toBeLessThan(5000); // hard limit
			expect(cost).toEqual(2541); // can be change slightly
		});

		it('supports override of recursionMultiplier=1 with one branch & resetting it back to 100 in others', () => {
			const typeDefs = `
				type Query {
					queryDeals: [Deal]
				}
				type Deal {
					id: ID
					pipeline: Pipeline
					user: User
				}
				type Pipeline {
					id: ID
					deals: [Deal]
				}
				type User {
				    name: String!

				    deals: [Deal]
				}
			`;

			const costMap = {
				Deal: {
					pipeline: {
						tokens: 100,
						useMultipliers: false,
						recursionMultiplier: 2, // usual override,
					},
					user: {
						tokens: 100,
						useMultipliers: false,
						// ! important part of resetting recursion coefficient back to default 100 in one of the params
						recursionMultiplier: 100,
					},
				},
				Pipeline: {
					deals: {
						tokens: 100,
						useMultipliers: false,
						recursionMultiplier: 2,
					},
				},
				Query: {
					queryDeals: {
						tokens: 100,
						recursionMultiplier: 1,
					},
				},
			};

			const query = `query {
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

								user {
									name
									deals {
										user {
											name
										}
									}
								}
							}
						}
					}
			}`;
			const cost = calculateCost(query, typeDefs, { costMap });

			expect(cost).toBeGreaterThan(5000); // hard limit
			expect(cost).toEqual(1022743); // can be change slightly
		});

		it('README example', () => {
			const typeDefs = `
				type Query {
				  myTree: [TreeLeaf]
				}

				type TreeLeaf {
				  id: ID
				  leafs: [TreeLeaf]
				}
			`;

			const costMap = {
				TreeLeaf: {
					leafs: {
						recursionMultiplier: 1, // usual override,
					},
				},
			};

			const query = `query {
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
			}`;
			const cost = calculateCost(query, typeDefs, { costMap });

			expect(cost).toBeLessThan(5000); // hard limit
			expect(cost).toEqual(6); // can be change slightly
		});
	});
});
