const {
	buildSchema,
	ValidationContext,
	parse,
	visitWithTypeInfo,
	TypeInfo,
	visit,
} = require('graphql');
const CostVisitor = require('./costVisitor');

module.exports = function calculateCost(
	query,
	schema,
	{ costMap, defaultCost = 1, variables }
) {
	schema = typeof schema === 'string' ? buildSchema(schema) : schema;
	query = typeof query === 'string' ? parse(query) : query;

	const typeInfo = new TypeInfo(schema);
	const validationContext = new ValidationContext(schema, query, typeInfo);
	const { getCurrentCost, visitor } = new CostVisitor(validationContext, {
		costMap,
		defaultCost,
		variables,
	});

	visit(query, visitWithTypeInfo(typeInfo, visitor));

	return getCurrentCost();
};
