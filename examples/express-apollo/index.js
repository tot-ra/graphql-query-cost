const request = require('request-promise-native');
const { ApolloServer, gql } = require('apollo-server-express');
const express = require('express');
const app = express();
const { json } = require('body-parser');
const { calculateCost, costDirective, extractCost } = require('../../lib');

const schema = `
	${costDirective}

	type Query {
		hello: String @cost(complexity: 1)
		world: String @cost(network: 1000)
	}
`;
const { costMap, cleanSchema } = extractCost(schema);

console.log(JSON.stringify({ costMap, cleanSchema }, null, 2));

const resolvers = {
	Query: {
		hello: () => 'World',
		world: () => new Error('Too expensive'),
	},
};

const server = new ApolloServer({ typeDefs: cleanSchema, resolvers });
const router = express.Router();

router.use(json());
router.use((req, res, next) => {
	const costLimitPerOperation = {
		defaultCost: 1,
		maximumCost: 5000
	};

	const { query, variables, operationName } = req.body;
	const cost = calculateCost(query, cleanSchema, {
		defaultCost: costLimitPerOperation.defaultCost,
		costMap,
		variables
	});

	if (cost > costLimitPerOperation.maximumCost) {
		res.status(413)
		res.write(`Cost (${cost}) exceeded the limit (${costLimitPerOperation.maximumCost}) for query operation ${operationName}`);
		res.end();

		return;
	}
	
	next();
})


app.use(router);
server.applyMiddleware({ app });
app.listen(6100, () => {
	console.log(`🚀 Server ready at http://localhost:6100`);

	function query(str) {
		request.post('http://localhost:6100/graphql', {
			json: {
				query: str,
			},
			simple: false
		}).then((res) => {
			console.log(res);
		})
	}

	setTimeout(() => {
		query(`query {
			hello
		}`)
	}, 1000)

	setTimeout(() => {
		query(`query {
			world
		}`)
	}, 2000)
});